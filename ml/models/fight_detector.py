"""两阶段打架识别: YOLO-Pose 提取骨骼关键点 + 轻量时序分类头 (LSTM)。

特征: 每帧每人 17 关键点 * 6 通道 (x, y, score, vx, vy, 0)，多人拼接。
      (x,y) 经归一化(居中骨盆/按肩宽缩放)，(vx,vy) 为帧间速度，体现运动剧烈度。
依赖: ultralytics, torch
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

try:
    from ultralytics import YOLO
except Exception:  # 未安装时仍能导入模块
    YOLO = None

N_KPT = 17
K_DEFAULT = 2
FEAT_PER_KPT = 6  # x, y, score, vx, vy, (pad) -> 见 build_features
_LHIP, _RHIP, _LSH, _RSH = 11, 12, 5, 6
# COCO 左右对称关键点对 (用于水平翻转增强)
LR_PAIRS = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16)]


@dataclass
class DetectResult:
    score: float              # 打架概率 0~1
    keypoints: np.ndarray     # (T, K, 17, 3) 原始关键点


def normalize_keypoints(kpts: np.ndarray) -> np.ndarray:
    """kpts: (..., 17, 3) -> (x,y) 居中到骨盆、按肩宽缩放; score 保留。

    支持 (T,17,3) / (T,K,17,3)；对缺失(全零)的人保持全零。
    """
    out = kpts.astype(np.float32).copy()
    pelvis = (out[..., _LHIP, :] + out[..., _RHIP, :]) / 2.0          # (...,3)
    sh = out[..., _LSH, :2] - out[..., _RSH, :2]
    scale = np.maximum(np.linalg.norm(sh, axis=-1), 1e-3)[..., None]  # (...,1)
    present = (out[..., :, 2].sum(-1) > 0)                            # (...)
    xy = (out[..., :, :2] - pelvis[..., None, :2]) / scale[..., None, :]
    out[..., :, :2] = xy * present[..., None, None]
    out[..., :, 2] *= present[..., None]
    return out


def build_features(kpts_raw: np.ndarray) -> np.ndarray:
    """(T, ..., 17, 3) 原始关键点 -> (T, ..., 17, 6) 特征 (x,y,score,vx,vy,0)。

    时间轴为第 0 维; 速度=相邻帧差分, 反映运动剧烈程度。
    """
    arr = normalize_keypoints(kpts_raw)                # (T,...,17,3)
    score = arr[..., 2:3]                              # (T,...,17,1)
    xy = arr[..., :2]                                  # (T,...,17,2)
    vel = np.zeros_like(xy)
    vel[1:] = xy[1:] - xy[:-1]
    zero = np.zeros_like(score)
    return np.concatenate([xy, score, vel, zero], axis=-1).astype(np.float32)  # 6通道


def flip_keypoints(feats: np.ndarray) -> np.ndarray:
    """水平翻转(已归一化特征): x、vx 取反并交换左右关键点。feats: (...,17,6)。"""
    out = feats.copy()
    out[..., 0] *= -1.0                     # x
    out[..., 3] *= -1.0                     # vx
    for a, b in LR_PAIRS:
        out[..., [a, b], :] = out[..., [b, a], :]
    return out


class PoseExtractor:
    def __init__(self, weights: str = "yolo11s-pose.pt", k: int = K_DEFAULT, imgsz: int = 640):
        if YOLO is None:
            raise RuntimeError("请先 pip install ultralytics")
        self.model = YOLO(weights)
        self.k = k
        self.imgsz = imgsz

    def extract(self, frames) -> np.ndarray:
        """对每帧跑 pose，取面积最大的 K 个人，返回 (T, K, 17, 3)。"""
        results = self.model(list(frames), verbose=False, imgsz=self.imgsz)
        seq = []
        for res in results:
            if res.keypoints is not None and res.keypoints.data.shape[0] > 0:
                kd = res.keypoints.data.cpu().numpy()                # (N,17,3)
                if res.boxes is not None and res.boxes.shape[0] > 0:
                    wh = (res.boxes.xywh[:, 2] * res.boxes.xywh[:, 3]).cpu().numpy()
                    order = np.argsort(-wh)[: self.k]
                else:
                    order = np.arange(min(self.k, kd.shape[0]))
                sel = kd[order].astype(np.float32)
                if sel.shape[0] < self.k:
                    pad = np.zeros((self.k - sel.shape[0], N_KPT, 3), dtype=np.float32)
                    sel = np.concatenate([sel, pad], axis=0)
            else:
                sel = np.zeros((self.k, N_KPT, 3), dtype=np.float32)
            seq.append(sel)
        return np.stack(seq) if seq else np.zeros((0, self.k, N_KPT, 3), np.float32)


class TemporalClassifier(nn.Module):
    """对关键点特征序列 (B,T,...) 分类 打架/非打架；时长度无关(均值池化)。"""

    def __init__(self, feat_dim: int = K_DEFAULT * N_KPT * FEAT_PER_KPT, hidden: int = 96,
                 num_layers: int = 2, num_class: int = 2,
                 dropout: float = 0.4, num_frames: int = 32):
        super().__init__()
        self.num_frames = num_frames
        self.feat_dim = feat_dim
        self.k = feat_dim // (N_KPT * FEAT_PER_KPT)   # 期望人数
        self.embed = nn.Linear(feat_dim, hidden)
        self.lstm = nn.LSTM(hidden, hidden, num_layers, batch_first=True,
                            bidirectional=True, dropout=dropout)
        self.head = nn.Sequential(
            nn.Linear(hidden * 2, hidden), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(hidden, num_class),
        )

    def encode(self, x):
        """返回序列表征 (B, hidden*2)；自监督预训练与监督微调共用此编码器。"""
        if x.dim() > 3:
            x = x.reshape(x.size(0), x.size(1), -1)   # (B,T,feat)
        x = self.embed(x)
        out, _ = self.lstm(x)
        return out.mean(dim=1)                         # (B, hidden*2)

    def forward(self, x):
        return self.head(self.encode(x))

    def load_pretrained_encoder(self, path, map_location="cpu"):
        """从自监督预训练权重加载 embed/lstm (head 保持随机初始化后微调)。"""
        ckpt = torch.load(path, map_location=map_location, weights_only=False)
        self.embed.load_state_dict(ckpt["embed"])
        self.lstm.load_state_dict(ckpt["lstm"])
        return ckpt.get("meta", {})

    @torch.no_grad()
    def predict_proba(self, kpts_np: np.ndarray, device: str | None = None) -> float:
        self.eval()
        device = device or next(self.parameters()).device
        self.to(device)
        if kpts_np.ndim == 3:                          # (T,17,3) -> (T,1,17,3)
            kpts_np = kpts_np[:, None]
        elif kpts_np.ndim == 2:
            kpts_np = kpts_np[None, None]
        feats = build_features(kpts_np)                # (T,K,17,6)
        # 对齐人数轴到模型期望的 k
        if feats.shape[1] > self.k:
            feats = feats[:, :self.k]
        elif feats.shape[1] < self.k:
            pad = np.zeros((feats.shape[0], self.k - feats.shape[1]) + feats.shape[2:], np.float32)
            feats = np.concatenate([feats, pad], axis=1)
        T = self.num_frames
        if feats.shape[0] > T:
            feats = feats[:T]
        elif feats.shape[0] < T:
            pad = np.zeros((T - feats.shape[0],) + feats.shape[1:], np.float32)
            feats = np.concatenate([feats, pad], axis=0)
        x = torch.from_numpy(feats).float().unsqueeze(0).to(device)
        logits = self.forward(x)
        return float(torch.softmax(logits, dim=-1)[0, 1].item())


class FightDetector:
    def __init__(self, pose_weights: str = "yolo11s-pose.pt",
                 num_frames: int = 32, k: int = K_DEFAULT, device: str = "cuda",
                 classifier_weights: str | None = None):
        self.device = device if (torch.cuda.is_available() and device == "cuda") else "cpu"
        self.pose = PoseExtractor(pose_weights, k=k)
        self.cls = TemporalClassifier(num_frames=num_frames)
        if classifier_weights and Path(classifier_weights).exists():
            self.cls.load_state_dict(torch.load(classifier_weights, map_location=self.device))
        self.cls.to(self.device).eval()

    def predict_video(self, frames) -> DetectResult:
        kpts = self.pose.extract(frames)              # (T,K,17,3)
        score = self.cls.predict_proba(kpts, self.device)
        return DetectResult(score=score, keypoints=kpts)
