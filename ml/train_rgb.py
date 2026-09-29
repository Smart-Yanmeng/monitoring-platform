"""方案2 训练: Kinetics-400 预训练 3D 骨干微调打架二分类。

输入为 scripts/extract_clips.py 产出的裁剪片段 .npy (T,res,res,3) uint8 RGB。
运行: python -m train_rgb --epochs 20 --batch 16 --backbone r2plus1d_18
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

from models.video_classifier import build_model, IMAGENET_MEAN, IMAGENET_STD

CLIP_DIR = "data/clips"
CKPT = "data/checkpoints/fight_rgb.pt"


class ClipDataset(Dataset):
    def __init__(self, manifest, clip_dir, split, num_frames=16, res=160, augment=False):
        self.rows = [r for r in csv.DictReader(open(manifest, encoding="utf-8")) if r["split"] == split]
        self.dir = Path(clip_dir)
        self.T = num_frames
        self.res = res
        self.augment = augment
        self.mean = np.array(IMAGENET_MEAN, np.float32)
        self.std = np.array(IMAGENET_STD, np.float32)

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        r = self.rows[i]
        cls = "fight" if r["label"] == "1" else "nonfight"
        clip = np.load(self.dir / r["split"] / cls / (Path(r["video_path"]).stem + ".npy"))
        T0 = clip.shape[0]
        if self.augment and np.random.rand() < 0.5:            # 时间裁剪+重采样
            L = np.random.randint(max(1, int(0.7 * T0)), T0 + 1)
            s = np.random.randint(0, T0 - L + 1)
            idx = (np.linspace(0, L - 1, self.T) + s).round().astype(int)
            clip = clip[np.clip(idx, 0, T0 - 1)]
        else:
            idx = np.linspace(0, T0 - 1, self.T).round().astype(int)
            clip = clip[idx]
        x = clip.astype(np.float32) / 255.0
        if self.augment and np.random.rand() < 0.5:            # 水平翻转
            x = x[:, :, ::-1]
        x = (x - self.mean) / self.std
        x = torch.from_numpy(np.ascontiguousarray(x)).permute(0, 3, 1, 2)  # (T,C,H,W)
        return x, int(r["label"])


def collate(batch):
    return torch.stack([b[0] for b in batch]), torch.tensor([b[1] for b in batch])


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    correct = total = tp = fp = fn = 0
    for xs, ys in loader:
        xs, ys = xs.to(device), ys.to(device)
        pred = model(xs).argmax(1).cpu().numpy()
        y = ys.cpu().numpy()
        total += y.size
        correct += int((pred == y).sum())
        tp += int(((pred == 1) & (y == 1)).sum())
        fp += int(((pred == 1) & (y == 0)).sum())
        fn += int(((pred == 0) & (y == 1)).sum())
    acc = correct / max(1, total)
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 2 * prec * rec / max(1e-6, prec + rec)
    return acc, f1, prec, rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="data/manifests/rwf2000.csv")
    ap.add_argument("--clip-dir", default=CLIP_DIR)
    ap.add_argument("--num-frames", type=int, default=16)
    ap.add_argument("--res", type=int, default=160)
    ap.add_argument("--backbone", default="resnet18")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--label-smooth", type=float, default=0.05)
    ap.add_argument("--ckpt", default=CKPT)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--num-workers", type=int, default=2)
    ap.add_argument("--freeze-backbone", action="store_true")
    ap.add_argument("--class-weight", action="store_true", help="按类别频率加权交叉熵")
    args = ap.parse_args()

    device = args.device if (torch.cuda.is_available() and args.device == "cuda") else "cpu"
    print("device:", device, "backbone:", args.backbone, flush=True)

    train_ds = ClipDataset(args.manifest, args.clip_dir, "train", args.num_frames, args.res, True)
    val_ds = ClipDataset(args.manifest, args.clip_dir, "val", args.num_frames, args.res, False)
    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True,
                          num_workers=args.num_workers, collate_fn=collate, pin_memory=True)
    val_dl = DataLoader(val_ds, batch_size=args.batch, shuffle=False,
                        num_workers=args.num_workers, collate_fn=collate, pin_memory=True)
    print(f"train={len(train_ds)} val={len(val_ds)}", flush=True)

    model = build_model(args.backbone, num_class=2, pretrained=True).to(device)
    if args.freeze_backbone:
        for n, p in model.named_parameters():
            if not n.startswith("head."):
                p.requires_grad = False
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],
                            lr=args.lr, weight_decay=args.weight_decay)
    if args.class_weight:
        n_pos = sum(1 for r in train_ds.rows if int(r["label"]) == 1)
        n_neg = max(1, len(train_ds.rows) - n_pos)
        w = torch.tensor([len(train_ds.rows) / (2 * n_neg),
                          len(train_ds.rows) / (2 * max(1, n_pos))],
                         dtype=torch.float32, device=device)
        crit = nn.CrossEntropyLoss(weight=w, label_smoothing=args.label_smooth)
        print(f"==> 类别加权: nonfight={w[0]:.3f} fight={w[1]:.3f}", flush=True)
    else:
        crit = nn.CrossEntropyLoss(label_smoothing=args.label_smooth)
    sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    best_f1 = -1.0
    Path(args.ckpt).parent.mkdir(parents=True, exist_ok=True)
    for epoch in range(1, args.epochs + 1):
        model.train()
        tot = n = 0
        for xs, ys in train_dl:
            xs, ys = xs.to(device), ys.to(device)
            opt.zero_grad()
            loss = crit(model(xs), ys)
            loss.backward()
            opt.step()
            tot += loss.item() * xs.size(0)
            n += xs.size(0)
        sch.step()
        acc, f1, prec, rec = evaluate(model, val_dl, device)
        print(f"[epoch {epoch}/{args.epochs}] loss={tot / max(1, n):.4f} "
              f"val_acc={acc:.4f} f1={f1:.4f} prec={prec:.4f} rec={rec:.4f}", flush=True)
        if f1 > best_f1:
            best_f1 = f1
            torch.save(model.state_dict(), args.ckpt)
            print(f"  -> saved best ckpt ({args.ckpt})", flush=True)

    print(f"TRAIN_RGB_DONE best_val_f1={best_f1:.4f} ckpt={args.ckpt}", flush=True)


if __name__ == "__main__":
    main()
