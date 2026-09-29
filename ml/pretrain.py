"""自监督对比预训练 (SimCLR 式 NT-Xent) 在骨骼关键点序列上。

用训练集(默认仅 train split，不含 val)的**无标签**关键点学习通用时序表征，
产物 encoder_pretrained.pt 供 train.py 微调（--pretrain）。
运行: python -m pretrain --epochs 150 --batch 256
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn
from torch.utils.data import Dataset, DataLoader

from models.fight_detector import (
    build_features, flip_keypoints, K_DEFAULT, FEAT_PER_KPT, N_KPT,
)

OUT = "data/checkpoints/encoder_pretrained.pt"


class RawKeypointDataset(Dataset):
    """返回原始关键点序列 (T0,K,17,3)；自监督不需要标签。"""

    def __init__(self, manifest, kp_dir, split="train"):
        self.items = []
        for r in csv.DictReader(open(manifest, encoding="utf-8")):
            if split and r["split"] != split:
                continue
            cls = "fight" if r["label"] == "1" else "nonfight"
            p = Path(kp_dir) / r["split"] / cls / (Path(r["video_path"]).stem + ".npy")
            if p.exists():
                self.items.append(p)

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        return np.load(self.items[i]).astype(np.float32)   # (T0,K,17,3)


def make_view(raw, T, rng):
    """单条原始序列 -> 随机增强后的特征视图 (T,K,17,6)。"""
    T0 = raw.shape[0]
    L = int(rng.integers(max(1, int(0.6 * T0)), T0 + 1))   # 随机时间裁剪
    s = int(rng.integers(0, T0 - L + 1))
    seg = raw[s:s + L]
    if L != T:                                             # 线性重采样到 T 帧
        idx = np.linspace(0, L - 1, T)
        lo = np.floor(idx).astype(int)
        hi = np.minimum(lo + 1, L - 1)
        w = (idx - lo)[:, None, None, None].astype(np.float32)
        seg = seg[lo] * (1 - w) + seg[hi] * w
    feats = build_features(seg)                            # (T,K,17,6)
    if rng.random() < 0.5:
        feats = flip_keypoints(feats)
    if rng.random() < 0.8:                                 # 关键点空间抖动
        feats[..., :2] += rng.normal(0, 0.02, feats[..., :2].shape).astype(np.float32)
    if rng.random() < 0.3:                                 # 随机帧遮罩
        feats[rng.random(T) < 0.2] = 0.0
    return feats


class SimCLRModel(nn.Module):
    def __init__(self, feat_dim, hidden=96, num_layers=2, dropout=0.4, proj_dim=128):
        super().__init__()
        self.embed = nn.Linear(feat_dim, hidden)
        self.lstm = nn.LSTM(hidden, hidden, num_layers, batch_first=True,
                            bidirectional=True, dropout=dropout)
        self.proj = nn.Sequential(nn.Linear(hidden * 2, hidden), nn.ReLU(),
                                  nn.Linear(hidden, proj_dim))

    def forward(self, x):
        if x.dim() > 3:
            x = x.reshape(x.size(0), x.size(1), -1)
        x = self.embed(x)
        out, _ = self.lstm(x)
        pooled = out.mean(dim=1)
        return self.proj(pooled), pooled


def nt_xent(z1, z2, temp=0.2):
    z = F.normalize(torch.cat([z1, z2], dim=0), dim=1)
    n = z.size(0)
    sim = z @ z.t() / temp
    sim.fill_diagonal_(-1e9)
    labels = torch.cat([torch.arange(n // 2, n), torch.arange(0, n // 2)]).to(z.device)
    return F.cross_entropy(sim, labels)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="data/manifests/rwf2000.csv")
    ap.add_argument("--kp-dir", default="data/keypoints")
    ap.add_argument("--split", default="train", help="用于预训练的分组(留空=全部)")
    ap.add_argument("--num-frames", type=int, default=32)
    ap.add_argument("--k", type=int, default=K_DEFAULT)
    ap.add_argument("--epochs", type=int, default=150)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", type=int, default=96)
    ap.add_argument("--dropout", type=float, default=0.4)
    ap.add_argument("--temp", type=float, default=0.2)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()

    device = args.device if (torch.cuda.is_available() and args.device == "cuda") else "cpu"
    print("device:", device, flush=True)
    rng = np.random.default_rng(0)

    ds = RawKeypointDataset(args.manifest, args.kp_dir, args.split or None)
    dl = DataLoader(ds, batch_size=args.batch, shuffle=True, num_workers=0)
    print(f"pretrain samples={len(ds)} (split={args.split}, 无标签)", flush=True)

    feat_dim = args.k * N_KPT * FEAT_PER_KPT
    model = SimCLRModel(feat_dim, hidden=args.hidden, dropout=args.dropout).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    for epoch in range(1, args.epochs + 1):
        model.train()
        tot = n = 0
        for raw in dl:
            raw = raw.numpy()
            v1 = torch.from_numpy(np.stack([make_view(x, args.num_frames, rng) for x in raw])).to(device)
            v2 = torch.from_numpy(np.stack([make_view(x, args.num_frames, rng) for x in raw])).to(device)
            z1, _ = model(v1)
            z2, _ = model(v2)
            loss = nt_xent(z1, z2, args.temp)
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += loss.item() * raw.shape[0]
            n += raw.shape[0]
        sch.step()
        if epoch % 10 == 0 or epoch == 1:
            print(f"[ssl {epoch}/{args.epochs}] info_nce_loss={tot / max(1, n):.4f}", flush=True)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save({"embed": model.embed.state_dict(), "lstm": model.lstm.state_dict(),
                "meta": {"hidden": args.hidden, "feat_dim": feat_dim,
                         "num_frames": args.num_frames, "k": args.k,
                         "split": args.split, "epochs": args.epochs}}, args.out)
    print(f"PRETRAIN_DONE -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
