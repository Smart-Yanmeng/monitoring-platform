"""统一评估: 按数据集来源拆分 val，输出各域指标 + 集成效果。

用法:
  python -m eval --manifest data/manifests/all_train.csv
  python -m eval --manifest data/manifests/all_train.csv --sweep-threshold
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

from train import KeypointDataset, source_of, collate
from train_rgb import ClipDataset, collate as collate_rgb
from models.fight_detector import TemporalClassifier, K_DEFAULT, N_KPT, FEAT_PER_KPT
from models.video_classifier import build_model


def metrics(pred, y):
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    acc = (tp + tn) / max(1, tp + tn + fp + fn)
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 2 * prec * rec / max(1e-6, prec + rec)
    return acc, f1, prec, rec


@torch.no_grad()
def score_skeleton(manifest, kp_dir, ckpt, k, device, num_frames=32):
    rows = [r for r in csv.DictReader(open(manifest, encoding="utf-8")) if r["split"] == "val"]
    ds = KeypointDataset(manifest, kp_dir, "val", num_frames, augment=False)
    model = TemporalClassifier(feat_dim=k * N_KPT * FEAT_PER_KPT, num_frames=num_frames,
                              hidden=96, dropout=0.4).to(device)
    model.load_state_dict(torch.load(ckpt, map_location=device))
    model.eval()
    probs = []
    from torch.utils.data import DataLoader
    dl = DataLoader(ds, batch_size=128, shuffle=False, collate_fn=collate)
    for xs, _ in dl:
        probs.append(torch.softmax(model(xs.to(device)), -1)[:, 1].cpu().numpy())
    return rows, np.concatenate(probs)


@torch.no_grad()
def score_rgb(manifest, clip_dir, ckpt, device, backbone="resnet18", num_frames=16, res=160):
    rows = [r for r in csv.DictReader(open(manifest, encoding="utf-8")) if r["split"] == "val"]
    ds = ClipDataset(manifest, clip_dir, "val", num_frames, res, False)
    model = build_model(backbone, num_class=2, pretrained=False).to(device)
    model.load_state_dict(torch.load(ckpt, map_location=device))
    model.eval()
    probs = []
    from torch.utils.data import DataLoader
    dl = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_rgb)
    for xs, _ in dl:
        probs.append(torch.softmax(model(xs.to(device)), -1)[:, 1].cpu().numpy())
    return rows, np.concatenate(probs)


def report(tag, rows, scores, threshold=0.5, w_skeleton=0.5):
    by_src = defaultdict(lambda: ([], []))
    for r, s in zip(rows, scores):
        src = source_of(Path(r["video_path"]).name)
        by_src[src][0].append(s)
        by_src[src][1].append(int(r["label"]))
    all_p, all_y = [], []
    print(f"\n===== {tag} (th={threshold}) =====")
    for src in sorted(by_src):
        s, y = by_src[src]
        s, y = np.array(s) >= threshold, np.array(y)
        acc, f1, prec, rec = metrics(s, y)
        print(f"  {src:8s} n={len(y):4d} acc={acc:.4f} f1={f1:.4f} prec={prec:.4f} rec={rec:.4f}")
        all_p.append(s); all_y.append(y)
    p, y = np.concatenate(all_p), np.concatenate(all_y)
    acc, f1, prec, rec = metrics(p, y)
    print(f"  {'ALL':8s} n={len(y):4d} acc={acc:.4f} f1={f1:.4f} prec={prec:.4f} rec={rec:.4f}")
    return acc, f1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="data/manifests/all_train.csv")
    ap.add_argument("--kp-dir", default="data/keypoints")
    ap.add_argument("--clip-dir", default="data/clips")
    ap.add_argument("--skeleton-ckpt", default="data/checkpoints/fight_lstm.pt")
    ap.add_argument("--rgb-ckpt", default="data/checkpoints/fight_rgb_resnet18.pt")
    ap.add_argument("--k", type=int, default=K_DEFAULT)
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()
    device = args.device if torch.cuda.is_available() else "cpu"

    rows, sk = score_skeleton(args.manifest, args.kp_dir, args.skeleton_ckpt, args.k, device)
    rows2, rgb = score_rgb(args.manifest, args.clip_dir, args.rgb_ckpt, device)
    assert [Path(r["video_path"]).name for r in rows] == [Path(r["video_path"]).name for r in rows2]

    report("骨架 Bi-LSTM", rows, sk)
    report("RGB ResNet18", rows, rgb)
    for w in (0.3, 0.4, 0.5, 0.6, 0.7):
        report(f"集成 w_sk={w}", rows, w * sk + (1 - w) * rgb)
    print("\n完成。阈值扫描: 重新运行并修改 threshold 可调。")


if __name__ == "__main__":
    main()
