"""训练时序分类头 (LSTM) 在 RWF-2000 骨骼关键点序列上。

流程: 若关键点未抽取(或与 meta 不匹配)则先抽取 -> 训练 -> 保存最佳权重 -> 验证集评估。
运行: python -m train --num-frames 32 --epochs 40 --batch 128
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

from models.fight_detector import (
    TemporalClassifier, build_features, flip_keypoints, K_DEFAULT, FEAT_PER_KPT, N_KPT,
)

KP_DIR = "data/keypoints"
CKPT = "data/checkpoints/fight_lstm.pt"


def source_of(name: str) -> str:
    """按文件名前缀判定数据集来源(rwf 无前缀)。"""
    low = name.lower()
    if low.startswith("hockey__"):
        return "hockey"
    if low.startswith("rlvs__"):
        return "rlvs"
    if low.startswith("surv__"):
        return "surv"
    return "rwf"


class KeypointDataset(Dataset):
    def __init__(self, manifest, kp_dir, split, num_frames=32, augment=False, frac=1.0,
                 only_source: str | None = None):
        self.rows = [r for r in csv.DictReader(open(manifest)) if r["split"] == split]
        if only_source:  # 仅在指定数据集上评估(跨域泛化检验)
            self.rows = [r for r in self.rows if source_of(Path(r["video_path"]).name) == only_source]
        if frac < 1.0:                                # 标签稀缺实验: 固定种子下采样
            rng = np.random.default_rng(42)
            idx = rng.permutation(len(self.rows))[: max(1, int(len(self.rows) * frac))]
            self.rows = [self.rows[i] for i in sorted(idx)]
        self.kp = Path(kp_dir)
        self.T = num_frames
        self.augment = augment

    def __len__(self):
        return len(self.rows)

    def _load(self, r):
        stem = Path(r["video_path"]).stem
        cls = "fight" if r["label"] == "1" else "nonfight"
        raw = np.load(self.kp / r["split"] / cls / f"{stem}.npy").astype(np.float32)  # (T,K,17,3)
        feats = build_features(raw)                                                   # (T,K,17,6)
        if feats.shape[0] > self.T:
            feats = feats[:self.T]
        elif feats.shape[0] < self.T:
            feats = np.concatenate(
                [feats, np.zeros((self.T - feats.shape[0],) + feats.shape[1:], np.float32)], 0)
        return feats

    def __getitem__(self, i):
        r = self.rows[i]
        feats = self._load(r)
        y = int(r["label"])
        if self.augment:
            if np.random.rand() < 0.5:                       # 水平翻转
                feats = flip_keypoints(feats)
            if np.random.rand() < 0.6:                       # 关键点空间抖动
                feats[..., :2] += np.random.randn(*feats[..., :2].shape).astype(np.float32) * 0.02
            if np.random.rand() < 0.3:                       # 随机时间遮罩
                t = np.random.randint(0, self.T)
                feats[t:] = 0.0
        return torch.from_numpy(feats.astype(np.float32)), y


def collate(batch):
    xs = torch.stack([b[0] for b in batch])
    ys = torch.tensor([b[1] for b in batch])
    return xs, ys


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    correct = total = 0
    tp = fp = tn = fn = 0
    for xs, ys in loader:
        xs, ys = xs.to(device), ys.to(device)
        pred = model(xs).argmax(1).cpu().numpy()
        y = ys.cpu().numpy()
        total += y.size
        correct += int((pred == y).sum())
        for p, yi in zip(pred, y):
            if yi == 1 and p == 1: tp += 1
            elif yi == 0 and p == 1: fp += 1
            elif yi == 0 and p == 0: tn += 1
            else: fn += 1
    acc = correct / max(1, total)
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 2 * prec * rec / max(1e-6, prec + rec)
    return acc, f1, prec, rec


def ensure_keypoints(args):
    """若关键点缺失或 meta 与本次配置不匹配则重新抽取。"""
    kp_path = Path(args.kp_dir)
    meta_p = kp_path / "meta.json"
    meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
    mismatch = (args.extract or not (kp_path / "train" / "fight").exists()
                or meta.get("k") != args.k or meta.get("num_frames") != args.num_frames
                or meta.get("imgsz") != args.imgsz)
    if mismatch:
        print(f"==> 抽取骨骼关键点 (k={args.k}, num_frames={args.num_frames}) ...", flush=True)
        from scripts.extract_keypoints import extract_all
        extract_all(args.manifest, args.kp_dir, args.num_frames, args.k,
                    args.pose_weights, args.imgsz, force=True)
    else:
        print(f"==> 复用已有关键点 {meta}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="data/manifests/rwf2000.csv")
    ap.add_argument("--kp-dir", default=KP_DIR)
    ap.add_argument("--num-frames", type=int, default=32)
    ap.add_argument("--k", type=int, default=K_DEFAULT, help="每帧保留人数")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", type=int, default=96)
    ap.add_argument("--dropout", type=float, default=0.4)
    ap.add_argument("--weight-decay", type=float, default=1e-3)
    ap.add_argument("--label-smooth", type=float, default=0.05)
    ap.add_argument("--ckpt", default=CKPT)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--num-workers", type=int, default=4)
    ap.add_argument("--extract", action="store_true", help="强制重新抽取关键点")
    ap.add_argument("--pose-weights", default="yolo11s-pose.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--pretrain", default="data/checkpoints/encoder_pretrained.pt",
                    help="自监督预训练编码器权重(不存在则从零训练)")
    ap.add_argument("--train-frac", type=float, default=1.0, help="训练集使用比例(标签稀缺实验)")
    ap.add_argument("--class-weight", action="store_true", help="按类别频率加权交叉熵")
    ap.add_argument("--val-source", default=None, help="仅在指定数据集(val)上评估: rwf|hockey|rlvs")
    args = ap.parse_args()

    device = args.device if (torch.cuda.is_available() and args.device == "cuda") else "cpu"
    print("device:", device, flush=True)

    ensure_keypoints(args)

    train_ds = KeypointDataset(args.manifest, args.kp_dir, "train", args.num_frames,
                               augment=True, frac=args.train_frac)
    val_ds = KeypointDataset(args.manifest, args.kp_dir, "val", args.num_frames, augment=False,
                             only_source=args.val_source)
    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True,
                          num_workers=args.num_workers, collate_fn=collate, pin_memory=True)
    val_dl = DataLoader(val_ds, batch_size=args.batch, shuffle=False,
                        num_workers=args.num_workers, collate_fn=collate, pin_memory=True)
    print(f"train={len(train_ds)} val={len(val_ds)}", flush=True)

    feat_dim = args.k * N_KPT * FEAT_PER_KPT
    model = TemporalClassifier(feat_dim=feat_dim, num_frames=args.num_frames,
                               hidden=args.hidden, dropout=args.dropout).to(device)
    if args.pretrain and Path(args.pretrain).exists():
        meta = model.load_pretrained_encoder(args.pretrain, map_location=device)
        print(f"==> 已加载自监督预训练编码器 {args.pretrain} {meta}", flush=True)
    else:
        print("==> 未找到预训练编码器，从零训练", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    if args.class_weight:
        n_pos = sum(1 for r in train_ds.rows if int(r["label"]) == 1)
        n_neg = max(1, len(train_ds.rows) - n_pos)
        w = torch.tensor([len(train_ds.rows) / (2 * n_neg), len(train_ds.rows) / (2 * max(1, n_pos))],
                         dtype=torch.float32, device=device)
        crit = nn.CrossEntropyLoss(weight=w, label_smoothing=args.label_smooth)
        print(f"==> 类别加权: nonfight={w[0]:.3f} fight={w[1]:.3f} (pos={n_pos} neg={n_neg})", flush=True)
    else:
        crit = nn.CrossEntropyLoss(label_smoothing=args.label_smooth)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    best_f1 = -1.0
    Path(args.ckpt).parent.mkdir(parents=True, exist_ok=True)
    for epoch in range(1, args.epochs + 1):
        model.train()
        running = n = 0
        for xs, ys in train_dl:
            xs, ys = xs.to(device), ys.to(device)
            opt.zero_grad()
            loss = crit(model(xs), ys)
            loss.backward()
            opt.step()
            running += loss.item() * xs.size(0)
            n += xs.size(0)
        scheduler.step()
        acc, f1, prec, rec = evaluate(model, val_dl, device)
        print(f"[epoch {epoch}/{args.epochs}] train_loss={running / max(1, n):.4f} "
              f"val_acc={acc:.4f} f1={f1:.4f} prec={prec:.4f} rec={rec:.4f}", flush=True)
        if f1 > best_f1:
            best_f1 = f1
            torch.save(model.state_dict(), args.ckpt)
            print(f"  -> saved best ckpt ({args.ckpt})", flush=True)

    print(f"TRAIN_DONE best_val_f1={best_f1:.4f} ckpt={args.ckpt}", flush=True)


if __name__ == "__main__":
    main()
