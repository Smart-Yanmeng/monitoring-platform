"""打架识别推理服务 (FastAPI)。

- 读取摄像头 RTSP 流，按滑动窗口抽帧
- 用 FightDetector 判打架
- 命中后 POST 到监控平台后端 /api/alarms

运行: uvicorn inference.service:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Query, UploadFile
from fastapi.responses import FileResponse

try:
    import httpx  # 仅报警推送需要，缺失时不影响检测功能
except Exception:  # pragma: no cover
    httpx = None
from fastapi.staticfiles import StaticFiles

from inference.rtsp_capture import rtsp_frames
from models.ensemble_detector import EnsembleFightDetector

app = FastAPI(title="Fight Detection Service")

STATIC_DIR = Path(__file__).parent / "static"

BACKEND_URL = os.getenv("BACKEND_ALARM_URL", "http://localhost:8080/api/alarms")
BACKEND_TOKEN = os.getenv("BACKEND_TOKEN", "")
THRESHOLD = float(os.getenv("FIGHT_THRESHOLD", "0.5"))
NUM_FRAMES = int(os.getenv("FIGHT_NUM_FRAMES", "32"))
FIGHT_K = int(os.getenv("FIGHT_K", "2"))
POSE_WEIGHTS = os.getenv("FIGHT_POSE_WEIGHTS", "yolo11s-pose.pt")
SKELETON_WEIGHTS = os.getenv("FIGHT_CLASSIFIER_WEIGHTS", "data/checkpoints/fight_lstm.pt")
RGB_WEIGHTS = os.getenv("FIGHT_RGB_WEIGHTS", "data/checkpoints/fight_rgb_resnet18.pt")
RGB_BACKBONE = os.getenv("FIGHT_RGB_BACKBONE", "resnet18")
RGB_NUM_FRAMES = int(os.getenv("FIGHT_RGB_NUM_FRAMES", "16"))
SKELETON_WEIGHT = float(os.getenv("FIGHT_SKELETON_WEIGHT", "0.4"))
DET_WEIGHTS = os.getenv("FIGHT_DET_WEIGHTS", "yolo11s.pt")

_detector = None


def detector() -> EnsembleFightDetector:
    """集成检测器(骨架+RGB)；权重缺失时自动降级为可用单模态。"""
    global _detector
    if _detector is None:
        _detector = EnsembleFightDetector(
            pose_weights=POSE_WEIGHTS, num_frames=NUM_FRAMES, k=FIGHT_K,
            skeleton_weights=SKELETON_WEIGHTS,
            rgb_det_weights=DET_WEIGHTS, rgb_backbone=RGB_BACKBONE,
            rgb_num_frames=RGB_NUM_FRAMES, rgb_weights=RGB_WEIGHTS,
            skeleton_weight=SKELETON_WEIGHT,
        )
    return _detector


def push_alarm(area: str, score: float, snapshot_rel: str | None = None,
               detail: dict | None = None) -> None:
    payload = {
        "type": "FIGHT",
        "area": area,
        "confidence": round(score, 3),
        "snapshotUrl": snapshot_rel or "",
    }
    if detail:
        payload["detail"] = detail
    if httpx is None:
        print("httpx 未安装，跳过报警推送:", payload)
        return
    headers = {"Authorization": f"Bearer {BACKEND_TOKEN}"} if BACKEND_TOKEN else {}
    try:
        httpx.post(BACKEND_URL, json=payload, headers=headers, timeout=5)
    except Exception as e:  # 报警推送失败不应中断推理
        print("push alarm failed:", e)


@app.get("/health")
def health():
    return {"status": "ok"}


def load_frames(path: str, fps_target: float = 5.0) -> list:
    """按目标帧率抽帧(默认 5fps)，供滑窗扫描使用。

    长视频若只均匀抽 NUM_FRAMES 帧撒满全长，会把只占几秒的打架信号稀释掉
    (实测 UCF 长视频会漏检)，故改为**先抽帧、再滑窗**。
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError("无法读取视频文件")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    step = max(1, int(round(fps / fps_target))) if fps > 0 else 1
    frames, i = [], 0
    while cap.isOpened():
        ok, fr = cap.read()
        if not ok:
            break
        if i % step == 0:
            frames.append(fr)
        i += 1
    cap.release()
    return frames


def iter_windows(frames: list, win: int, max_windows: int = 30) -> list:
    """把帧序列切成不重叠窗口；短于一个窗口则返回单窗口。"""
    if not frames:
        return []
    if len(frames) <= win:
        return [frames]
    out = [frames[i:i + win] for i in range(0, len(frames) - win + 1, win)][:max_windows]
    return out


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/detect")
async def detect(file: UploadFile = File(...)):
    """上传一段视频，返回是否打架及概率明细。

    对长视频做**滑窗扫描、取最大分**(而非整段均匀抽帧)，避免只占几秒的
    打架片段被稀释漏检；短视频退化为单窗口，行为与之前一致。
    """
    suffix = Path(file.filename or "clip.mp4").suffix or ".mp4"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(await file.read())
        tmp.close()
        t0 = time.time()
        frames = load_frames(tmp.name)
        if not frames:
            return {"ok": False, "error": "视频解析不到任何帧"}
        windows = iter_windows(frames, NUM_FRAMES)
        best = None
        for w in windows:
            r = detector().predict_video(w)
            if best is None or r.score > best.score:
                best = r
        elapsed = int((time.time() - t0) * 1000)
        return {
            "ok": True,
            "fight": bool(best.score >= THRESHOLD),
            "score": round(best.score, 4),
            "threshold": THRESHOLD,
            "skeleton_score": None if best.skeleton_score is None else round(best.skeleton_score, 4),
            "rgb_score": None if best.rgb_score is None else round(best.rgb_score, 4),
            "windows": len(windows),
            "frames": len(frames),
            "elapsed_ms": elapsed,
        }
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@app.post("/watch")
def watch(
    url: str = Query(..., description="RTSP 地址"),
    area: str = Query("未知区域", description="摄像头区域名"),
):
    """持续监控一路流（简化：同步扫描；生产建议改后台任务）。"""
    det = detector()
    window: list = []
    alarms = 0
    for fr in rtsp_frames(url, sample_fps=5):
        window.append(fr)
        if len(window) >= NUM_FRAMES:
            res = det.predict_video(window)
            detail = {"skeleton": res.skeleton_score, "rgb": res.rgb_score}
            print(f"[watch] {area} score={res.score:.3f} {detail}", flush=True)
            if res.score >= THRESHOLD:
                snap_rel = f"snapshots/{int(time.time())}.jpg"
                os.makedirs("snapshots", exist_ok=True)
                cv2.imwrite(snap_rel, window[-1])
                push_alarm(area, res.score, "/" + snap_rel, detail)
                alarms += 1
            window.clear()
    return {"done": True, "alarms": alarms}
