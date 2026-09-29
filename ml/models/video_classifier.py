"""方案2: RGB 视频分类 —— 2D CNN(ImageNet 预训练)逐帧提特征 + 时序池化。

为什么不用 3D 骨干: torchvision 的 R(2+1)D / SlowFast 在当前 CUDA + Blackwell(sm_120)
组合下 3D 卷积退化为极慢路径(实测 batch4 前反向 >14s, 一轮训练 20+ 分钟),
故改用 2D CNN 逐帧(帧当 batch) + mean/max 时序聚合, 实测快 ~25x 且显存更省。
"""
from __future__ import annotations

import torch
from torch import nn
from torchvision.models import resnet18, resnet50, ResNet18_Weights, ResNet50_Weights

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)

_BACKBONES = {
    "resnet18": (resnet18, ResNet18_Weights.IMAGENET1K_V1),
    "resnet50": (resnet50, ResNet50_Weights.IMAGENET1K_V2),
}


class FrameClassifier(nn.Module):
    """输入 (B,T,C,H,W): 2D 骨干逐帧 -> (B,T,feat) -> mean+max 聚合 -> FC。"""

    def __init__(self, backbone: str = "resnet18", num_class: int = 2,
                 pretrained: bool = True, dropout: float = 0.3, hidden: int = 256):
        super().__init__()
        if backbone not in _BACKBONES:
            raise ValueError(f"未知骨干 {backbone}, 可选: {list(_BACKBONES)}")
        fn, weights = _BACKBONES[backbone]
        net = fn(weights=weights if pretrained else None)
        self.feat_dim = net.fc.in_features
        net.fc = nn.Identity()
        self.backbone = net
        self.head = nn.Sequential(
            nn.Linear(self.feat_dim * 2, hidden), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(hidden, num_class),
        )

    def forward(self, x):
        B, T = x.shape[:2]
        f = self.backbone(x.reshape(B * T, *x.shape[2:]))   # (B*T, feat)
        f = f.reshape(B, T, -1)
        z = torch.cat([f.mean(dim=1), f.max(dim=1).values], dim=1)  # (B, 2*feat)
        return self.head(z)


def build_model(backbone: str = "resnet18", num_class: int = 2, pretrained: bool = True,
                dropout: float = 0.3) -> FrameClassifier:
    return FrameClassifier(backbone, num_class, pretrained, dropout)


def backbone_names():
    return list(_BACKBONES)
