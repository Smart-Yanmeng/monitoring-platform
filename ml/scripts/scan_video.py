"""对整段视频做滑窗扫描，输出逐窗口打架概率曲线(定性验证长视频表现)。

用法:
  python -m scripts.scan_video --video data/raw/_val_dl/sample_1.mp4 --stride 8
"""
from __future__ import annotations

import argparse
import json

import cv2
import numpy as np

from models.ensemble_detector import EnsembleFightDetector


def read_all_frames(path: str):
    cap = cv2.VideoCapture(path)
    frames = []
    while cap.isOpened():
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    return frames


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--num-frames", type=int, default=32)
    ap.add_argument("--stride", type=int, default=8)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--skeleton-weight", type=float, default=0.4)
    ap.add_argument("--pose-weights", default="yolo11s-pose.pt")
    ap.add_argument("--k", type=int, default=2)
    ap.add_argument("--skeleton-weights", default="data/checkpoints/fight_lstm.pt")
    ap.add_argument("--rgb-weights", default="data/checkpoints/fight_rgb_resnet18.pt")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    det = EnsembleFightDetector(
        pose_weights=args.pose_weights, num_frames=args.num_frames, k=args.k,
        skeleton_weights=args.skeleton_weights,
        rgb_weights=args.rgb_weights, skeleton_weight=args.skeleton_weight,
    )
    frames = read_all_frames(args.video)
    n = len(frames)
    fps = 1.0
    print(f"总帧数 {n}")

    results = []
    for start in range(0, max(1, n - args.num_frames + 1), args.stride):
        window = frames[start:start + args.num_frames]
        if len(window) < 4:
            break
        res = det.predict_video(window)
        sec = start / max(1, fps)
        results.append({
            "start": start, "t_sec": round(sec, 2),
            "score": round(res.score, 4),
            "skeleton": None if res.skeleton_score is None else round(res.skeleton_score, 4),
            "rgb": None if res.rgb_score is None else round(res.rgb_score, 4),
        })
        print(f"  frames[{start:5d}] score={res.score:.3f} "
              f"sk={res.skeleton_score if res.skeleton_score is None else round(res.skeleton_score,3)} "
              f"rgb={res.rgb_score if res.rgb_score is None else round(res.rgb_score,3)}", flush=True)

    if results:
        scores = np.array([r["score"] for r in results])
        hit = scores >= args.threshold
        print(f"\n窗口数={len(results)} 均值={scores.mean():.3f} 最大={scores.max():.3f} "
              f"命中窗口={int(hit.sum())}/{len(results)} ({hit.mean()*100:.0f}%)")
        print(f"结论: {'检测到打架' if hit.any() else '未检测到打架'} (阈值 {args.threshold})")
        if args.out:
            json.dump({"video": args.video, "threshold": args.threshold, "windows": results},
                      open(args.out, "w"), ensure_ascii=False, indent=1)
            print("已写出", args.out)


if __name__ == "__main__":
    main()
