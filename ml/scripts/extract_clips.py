"""方案2 预处理: YOLO 检测人体 -> 裁剪「人所在区域」-> RGB 片段 .npy。

输出: <out>/<split>/<fight|nonfight>/<stem>.npy  shape=(T,res,res,3) uint8 RGB
并写出 <out>/meta.json。裁剪框 = 片段内所有人框的并集(带边距); 无人则退回整帧。
运行: python -m scripts.extract_clips --manifest data/manifests/rwf2000.csv --out data/clips
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import cv2
import numpy as np

try:
    from ultralytics import YOLO
except Exception:  # pragma: no cover
    YOLO = None


def load_frames(path: str, num_frames: int = 16):
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 1)
    step = max(1, total // max(1, num_frames))
    frames, idx = [], 0
    while cap.isOpened():
        ok, fr = cap.read()
        if not ok:
            break
        if idx % step == 0:
            frames.append(fr)
        idx += 1
        if len(frames) >= num_frames:
            break
    cap.release()
    return frames


def person_union_box(results, W: int, H: int, margin: float = 0.08):
    """合并所有 person(class 0) 框; 返回 (x1,y1,x2,y2) 或 None。"""
    xs, ys = [], []
    for r in results:
        if r.boxes is None or r.boxes.shape[0] == 0:
            continue
        cls = r.boxes.cls.cpu().numpy()
        xyxy = r.boxes.xyxy.cpu().numpy()
        for c, b in zip(cls, xyxy):
            if int(c) == 0:  # person
                xs += [b[0], b[2]]
                ys += [b[1], b[3]]
    if not xs:
        return None
    x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
    mx, my = margin * (x2 - x1), margin * (y2 - y1)
    return int(max(0, x1 - mx)), int(max(0, y1 - my)), int(min(W, x2 + mx)), int(min(H, y2 + my))


def extract_all(manifest: str, out_dir: str, num_frames: int = 16, res: int = 160,
                det_weights: str = "yolo11s.pt", imgsz: int = 640,
                splits=("train", "val"), force: bool = False, limit: int = 0):
    if YOLO is None:
        raise RuntimeError("请先 pip install ultralytics")
    out = Path(out_dir)
    det = YOLO(det_weights)
    rows = [r for r in csv.DictReader(open(manifest, encoding="utf-8")) if r["split"] in splits]
    if limit:
        rows = rows[:limit]
    done = skip = 0
    for r in rows:
        vp = Path(r["video_path"])
        cls = "fight" if r["label"] == "1" else "nonfight"
        dst = out / r["split"] / cls / f"{vp.stem}.npy"
        if dst.exists() and not force:
            skip += 1
            continue
        frames = load_frames(str(vp), num_frames)
        if not frames:
            print("skip empty:", vp, flush=True)
            continue
        H, W = frames[0].shape[:2]
        results = det.predict(frames, verbose=False, imgsz=imgsz)
        box = person_union_box(results, W, H) or (0, 0, W, H)
        x1, y1, x2, y2 = box
        clip = []
        for f in frames:
            crop = f[y1:y2, x1:x2]
            if crop.size == 0:
                crop = f
            crop = cv2.resize(crop, (res, res))
            clip.append(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        dst.parent.mkdir(parents=True, exist_ok=True)
        np.save(dst, np.stack(clip).astype(np.uint8))
        done += 1
        if done % 100 == 0:
            print(f"  clips {done} (skip {skip})", flush=True)
    meta = {"num_frames": num_frames, "res": res, "det_weights": det_weights, "imgsz": imgsz}
    out.mkdir(parents=True, exist_ok=True)
    (out / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    print(f"DONE clips={done} skip={skip} meta={meta}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="data/manifests/rwf2000.csv")
    ap.add_argument("--out", default="data/clips")
    ap.add_argument("--num-frames", type=int, default=16)
    ap.add_argument("--res", type=int, default=160)
    ap.add_argument("--det-weights", default="yolo11s.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    extract_all(args.manifest, args.out, args.num_frames, args.res,
                args.det_weights, args.imgsz, force=args.force, limit=args.limit)


if __name__ == "__main__":
    main()
