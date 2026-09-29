"""离线抽取 RWF-2000 每个视频的骨骼关键点 -> .npy。

输出: <out>/<split>/<fight|nonfight>/<stem>.npy   shape=(T,K,17,3) 原始像素坐标
并写出 <out>/meta.json 记录 (k, num_frames, pose_weights)。
运行: python -m scripts.extract_keypoints --manifest data/manifests/rwf2000.csv --out data/keypoints
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import cv2
import numpy as np

from models.fight_detector import PoseExtractor


def load_frames(path: str, num_frames: int = 32):
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


def extract_all(manifest: str, out_dir: str, num_frames: int = 32, k: int = 2,
                pose_weights: str = "yolo11s-pose.pt", imgsz: int = 640,
                force: bool = False):
    out = Path(out_dir)
    pose = PoseExtractor(pose_weights, k=k, imgsz=imgsz)
    rows = list(csv.DictReader(open(manifest, encoding="utf-8")))
    done = skip = 0
    for r in rows:
        vp = Path(r["video_path"])
        stem = vp.stem
        cls = "fight" if r["label"] == "1" else "nonfight"
        dst = out / r["split"] / cls / f"{stem}.npy"
        if dst.exists() and not force:
            skip += 1
            continue
        frames = load_frames(str(vp), num_frames)
        if not frames:
            print("skip empty:", vp, flush=True)
            continue
        kpts = pose.extract(frames)                  # (T,K,17,3)
        dst.parent.mkdir(parents=True, exist_ok=True)
        np.save(dst, kpts.astype(np.float32))
        done += 1
        if done % 100 == 0:
            print(f"  extracted {done} (skip {skip})", flush=True)
    meta = {"k": k, "num_frames": num_frames, "pose_weights": pose_weights, "imgsz": imgsz}
    (out / "meta.json").parent.mkdir(parents=True, exist_ok=True)
    (out / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    print(f"DONE extracted={done} skip={skip} meta={meta}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="data/manifests/rwf2000.csv")
    ap.add_argument("--out", default="data/keypoints")
    ap.add_argument("--num-frames", type=int, default=32)
    ap.add_argument("--k", type=int, default=2, help="每帧保留的人数")
    ap.add_argument("--pose-weights", default="yolo11s-pose.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    extract_all(args.manifest, args.out, args.num_frames, args.k,
                args.pose_weights, args.imgsz, args.force)


if __name__ == "__main__":
    main()
