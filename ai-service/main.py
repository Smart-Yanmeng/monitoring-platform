#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校园监控 AI 接入服务（打架检测）

工作流：
  1. 从后端 GET  /api/models/active 获取当前「启用」的模型权重路径，
     若无则回退到环境变量 MODEL_PATH；模型变化时自动热加载。
  2. 从后端 GET  /api/devices?type=CAMERA 拉取摄像头列表
     （Device.address 即 RTSP 流地址，如 rtsp://user:pass@ip:554/stream）
  3. 每个摄像头单线程：OpenCV 拉流 -> 按 FRAME_SKIP 抽帧 -> YOLO 推理
  4. 命中「打架」类别且置信度 >= CONF_THRESHOLD 时，带冷却时间上报：
     POST /api/ai/events  （后端自动落库 + 站内信 + 视频墙高亮）
  5. 周期性 POST /api/ai/heartbeat 上报启用模型与各摄像头状态（供前端状态页展示）

配置（环境变量）：
  BACKEND_URL      后端地址，默认 http://localhost:8080
  API_KEY          X-Api-Key，需与后端 application.yml 的 app.ai.api-key 一致
  MODEL_PATH       兜底模型路径，当前端无启用模型时使用，默认 models/fight_yolo_small.pt
                   （与后端 DataInitializer 预置的启用模型一致；后端有启用模型时优先用后端返回）
  FIGHT_CLASS      打架类别名或索引，默认 violence（对应模型类别 violence/索引1）
  CONF_THRESHOLD   置信度阈值，默认 0.5
  FRAME_SKIP       每隔多少帧推理一次（1=每帧），默认 3
  COOLDOWN         同一摄像头两次报警最小间隔(秒)，默认 30
  POLL_INTERVAL    重新拉取摄像头列表的间隔(秒)，默认 30
  HEARTBEAT_INTERVAL 心跳上报间隔(秒)，默认 15

运行（仅摄像头接入，无 HTTP 接口）：
  pip install -r requirements.txt
  python main.py

运行（含上传视频识别 HTTP 接口，监听 :8000）：
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000
  前端在「视频识别」页上传视频 -> POST /detect -> 返回打架结论与分数时间轴。

注意：OpenCV 读取 RTSP 依赖系统 ffmpeg / openh264，请先确保已安装。
"""
import os
import time
import threading
import tempfile

import cv2
import requests
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

CONFIG = {
    "backend_url": os.environ.get("BACKEND_URL", "http://localhost:8080").rstrip("/"),
    "api_key": os.environ.get("API_KEY", "ai-ingest-secret-change-me"),
    "model_path": os.environ.get("MODEL_PATH", "models/fight_yolo_small.pt"),
    "fight_class": os.environ.get("FIGHT_CLASS", "violence"),
    "conf_threshold": float(os.environ.get("CONF_THRESHOLD", "0.5")),
    "frame_skip": int(os.environ.get("FRAME_SKIP", "3")),
    "cooldown": int(os.environ.get("COOLDOWN", "30")),
    "poll_interval": int(os.environ.get("POLL_INTERVAL", "30")),
    "heartbeat_interval": int(os.environ.get("HEARTBEAT_INTERVAL", "15")),
}


class BackendClient:
    def __init__(self, base: str, api_key: str):
        self.base = base
        self.session = requests.Session()
        self.session.headers.update({"X-Api-Key": api_key})

    def get_cameras(self):
        resp = self.session.get(f"{self.base}/api/devices",
                                params={"type": "CAMERA"}, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def get_active_model(self):
        try:
            resp = self.session.get(f"{self.base}/api/models/active", timeout=10)
            if resp.status_code == 204 or not resp.content:
                return None
            data = resp.json()
            return data.get("filePath")
        except requests.RequestException:
            return None

    def send_alarm(self, device_id, region_id, reason, level, confidence):
        payload = {
            "deviceId": device_id,
            "regionId": region_id,
            "reason": reason,
            "level": level,
            "confidence": confidence,
        }
        try:
            resp = self.session.post(f"{self.base}/api/ai/events", json=payload, timeout=10)
            if not resp.ok:
                print(f"[warn] 报警上报失败 {resp.status_code}: {resp.text}")
            return resp.ok
        except requests.RequestException as e:
            print(f"[warn] 报警上报异常: {e}")
            return False

    def heartbeat(self, active_model, cameras):
        payload = {"activeModel": active_model, "cameras": cameras}
        try:
            self.session.post(f"{self.base}/api/ai/heartbeat", json=payload, timeout=10)
        except requests.RequestException:
            pass


class FightDetector:
    def __init__(self, model_path, fight_class, conf_threshold):
        from ultralytics import YOLO
        self.model_path = model_path
        self.fight_class = str(fight_class).lower()
        self.conf = conf_threshold
        self.model = YOLO(model_path)

    def detect(self, frame):
        """返回最高置信度（命中打架时），未命中返回 None"""
        results = self.model.predict(frame, conf=self.conf, verbose=False)
        best = None
        for r in results:
            names = r.names
            for box in r.boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])
                name = str(names[cls]).lower()
                if name == self.fight_class or str(cls) == self.fight_class:
                    if best is None or conf > best:
                        best = conf
        return best

    def score_frame(self, frame):
        """返回该帧的打架置信度（0~1，未命中为 0），用于时间轴绘制"""
        conf = self.detect(frame)
        return conf if conf is not None else 0.0


class CameraWorker(threading.Thread):
    def __init__(self, camera, client: BackendClient, detector_holder: dict, last_alarm: dict):
        super().__init__(daemon=True)
        self.camera = camera
        self.client = client
        self.detector_holder = detector_holder
        self.last_alarm = last_alarm
        self.region_id = camera.get("regionId")
        self.running = True

    def run(self):
        url = self.camera.get("address")
        cam_id = self.camera.get("id")
        cam_name = self.camera.get("name", cam_id)
        if not url:
            print(f"[skip] 摄像头 {cam_name} 没有流地址(address)，跳过")
            return
        print(f"[start] 摄像头 {cam_name} 拉流: {url}")
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        frame_idx = 0
        while self.running:
            ok, frame = cap.read()
            if not ok:
                time.sleep(1)
                cap.release()
                cap = cv2.VideoCapture(url)  # 断流重连
                continue
            frame_idx += 1
            if frame_idx % CONFIG["frame_skip"] != 0:
                continue
            detector = self.detector_holder.get("detector")
            if detector is None:
                continue
            conf = detector.detect(frame)
            if conf is not None:
                now = time.time()
                if now - self.last_alarm.get(cam_id, 0) >= CONFIG["cooldown"]:
                    self.last_alarm[cam_id] = now
                    print(f"[ALARM] 摄像头 {cam_name} 检测到打架，置信度 {conf:.2f}")
                    self.client.send_alarm(cam_id, self.region_id, "打架", "CRITICAL", round(conf, 3))
        cap.release()
        print(f"[stop] 摄像头 {cam_name} 已停止")


def load_detector(model_path, fight_class, conf):
    print(f"[model] 加载模型: {model_path}")
    return FightDetector(model_path, fight_class, conf)


def load_detector(model_path, fight_class, conf):
    print(f"[model] 加载模型: {model_path}")
    return FightDetector(model_path, fight_class, conf)


# ── 运行时共享状态 ────────────────────────────
RT = {
    "client": None,
    "detector_holder": {},
    "last_alarm": {},
    "started": False,
}


def init_runtime():
    """构造后端客户端并加载启用模型（幂等）"""
    if RT["started"]:
        return
    client = BackendClient(CONFIG["backend_url"], CONFIG["api_key"])
    active_path = client.get_active_model() or CONFIG["model_path"]
    RT["detector_holder"] = {
        "detector": load_detector(active_path, CONFIG["fight_class"], CONFIG["conf_threshold"]),
        "path": active_path,
    }
    RT["client"] = client
    RT["last_alarm"] = {}
    RT["started"] = True


def run_ingestion_loop():
    """摄像头轮询主循环（RTSP 抽帧 -> 打架检测 -> 上报），阻塞运行"""
    client = RT["client"]
    detector_holder = RT["detector_holder"]
    last_alarm = RT["last_alarm"]
    workers = {}
    last_heartbeat = 0
    print(f"AI 服务启动，后端: {CONFIG['backend_url']}，当前模型: {detector_holder.get('path')}")
    while True:
        # 1) 同步启用模型（变化时热加载）
        backend_active = client.get_active_model()
        if backend_active and backend_active != detector_holder["path"]:
            try:
                detector_holder["detector"] = load_detector(
                    backend_active, CONFIG["fight_class"], CONFIG["conf_threshold"])
                detector_holder["path"] = backend_active
            except Exception as e:
                print(f"[error] 模型热加载失败: {e}")

        # 2) 拉取摄像头并维护工作线程
        try:
            cameras = client.get_cameras()
        except requests.RequestException as e:
            print(f"[error] 拉取摄像头失败: {e}")
            time.sleep(CONFIG["poll_interval"])
            continue

        ids = set()
        for cam in cameras:
            cid = cam.get("id")
            ids.add(cid)
            w = workers.get(cid)
            if w is None or not w.is_alive():
                if w is not None:
                    w.running = False
                nw = CameraWorker(cam, client, detector_holder, last_alarm)
                nw.start()
                workers[cid] = nw
        for cid in list(workers):
            if cid not in ids and workers[cid].is_alive():
                workers[cid].running = False

        # 3) 心跳上报
        now = time.time()
        if now - last_heartbeat >= CONFIG["heartbeat_interval"]:
            last_heartbeat = now
            cam_status = [
                {"id": cid, "status": "RUNNING" if w.is_alive() else "OFFLINE"}
                for cid, w in workers.items()
            ]
            client.heartbeat(detector_holder["path"], cam_status)

        time.sleep(CONFIG["poll_interval"])


# ── HTTP 上传识别接口（FastAPI） ──────────────
app = FastAPI(title="监控 AI 接入服务")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    # 以 uvicorn 方式运行时，后台启动摄像头接入循环
    init_runtime()
    threading.Thread(target=run_ingestion_loop, daemon=False).start()


@app.get("/health")
def health():
    return {"status": "ok", "model": RT["detector_holder"].get("path")}


def scan_video(path, detector):
    """按 ~5fps 抽帧，逐帧算打架分数（无打架为 0）。返回 (score列表, fps)"""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="无法打开视频文件")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    step = max(1, round(fps / 5))
    scores = []
    idx = 0
    while cap.isOpened():
        ok, fr = cap.read()
        if not ok:
            break
        if idx % step == 0:
            scores.append(detector.score_frame(fr))
        idx += 1
        if len(scores) >= 3000:  # 长视频安全上限
            break
    cap.release()
    return scores, fps


@app.post("/detect")
async def detect(file: UploadFile = File(...), threshold: Optional[float] = None):
    """上传视频，按目标帧率抽帧跑打架检测，返回整体结论与分数时间轴。"""
    detector = RT["detector_holder"].get("detector")
    if detector is None:
        init_runtime()
        detector = RT["detector_holder"].get("detector")
    if detector is None:
        raise HTTPException(status_code=503, detail="模型未加载，AI 服务未就绪")

    suffix = os.path.splitext(file.filename or "clip.mp4")[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(await file.read())
        tmp.close()
        scores, fps = scan_video(tmp.name, detector)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    if not scores:
        raise HTTPException(status_code=400, detail="视频解析不到任何帧")

    th = threshold if threshold is not None else CONFIG["conf_threshold"]
    max_score = max(scores)
    fight_frames = sum(1 for s in scores if s >= th)
    # 时间轴降采样到最多 80 个点
    n = len(scores)
    step = max(1, round(fps / 5)) if fps > 0 else 1
    target = 80
    if n > target:
        take_every = n / target
        timeline = [
            {"t": round((int(i * take_every) * step) / fps, 2),
             "score": round(scores[int(i * take_every)], 4)}
            for i in range(target)
        ]
    else:
        timeline = [
            {"t": round((k * step) / fps, 2), "score": round(s, 4)}
            for k, s in enumerate(scores)
        ]

    return {
        "ok": True,
        "filename": file.filename,
        "framesSampled": n,
        "maxScore": round(max_score, 4),
        "isFight": bool(max_score >= th),
        "fightFrames": fight_frames,
        "threshold": th,
        "timeline": timeline,
    }


def main():
    """以纯脚本方式运行（仅 RTSP 接入，不暴露 HTTP 接口）"""
    init_runtime()
    run_ingestion_loop()


if __name__ == "__main__":
    main()
