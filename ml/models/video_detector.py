"""方案2 推理封装: YOLO 检测并裁剪人体区域 -> 2D CNN 时序分类 -> 打架概率。

与方案1 的 FightDetector 接口一致(predict_video -> DetectResult)，便于切换。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch

from models.video_classifier import build_model, IMAGENET_MEAN, IMAGENET_STD

try:
    from ultralytics import YOLO
except Exception:  # pragma: no cover
    YOLO = None


@dataclass
class DetectResult:
    score: float              # 打架概率 0~1
    keypoints: np.ndarray | None = None


def _person_union_box(results, W, H, margin=0.08):
    xs, ys = [], []
    for r in results:
        if r.boxes is None or r.boxes.shape[0] == 0:
            continue
        cls = r.boxes.cls.cpu().numpy()
        xyxy = r.boxes.xyxy.cpu().numpy()
        for c, b in zip(cls, xyxy):
            if int(c) == 0:
                xs += [b[0], b[2]]
                ys += [b[1], b[3]]
    if not xs:
        return None
    x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
    mx, my = margin * (x2 - x1), margin * (y2 - y1)
    return int(max(0, x1 - mx)), int(max(0, y1 - my)), int(min(W, x2 + mx)), int(min(H, y2 + my))


class RGBFightDetector:
    def __init__(self, det_weights: str = "yolo11s.pt", backbone: str = "resnet18",
                 num_frames: int = 16, res: int = 160, device: str = "cuda",
                 classifier_weights: str | None = None):
        if YOLO is None:
            raise RuntimeError("请先 pip install ultralytics")
        self.device = device if (torch.cuda.is_available() and device == "cuda") else "cpu"
        self.det = YOLO(det_weights)
        self.T = num_frames
        self.res = res
        self.mean = np.array(IMAGENET_MEAN, np.float32)
        self.std = np.array(IMAGENET_STD, np.float32)
        self.model = build_model(backbone, num_class=2, pretrained=False).to(self.device)
        if classifier_weights and Path(classifier_weights).exists():
            self.model.load_state_dict(torch.load(classifier_weights, map_location=self.device))
        self.model.eval()

    @torch.no_grad()
    def predict_video(self, frames) -> DetectResult:
        # 均匀采样到 T 帧
        n = len(frames)
        idx = np.linspace(0, n - 1, self.T).round().astype(int) if n else []
        sampled = [frames[i] for i in idx]
        H, W = sampled[0].shape[:2]
        results = self.det.predict(sampled, verbose=False)
        box = _person_union_box(results, W, H) or (0, 0, W, H)
        x1, y1, x2, y2 = box
        clip = []
        for f in sampled:
            crop = f[y1:y2, x1:x2]
            if crop.size == 0:
                crop = f
            crop = cv2.resize(crop, (self.res, self.res))
            clip.append(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        x = np.stack(clip).astype(np.float32) / 255.0
        x = (x - self.mean) / self.std
        x = torch.from_numpy(np.ascontiguousarray(x)).permute(0, 3, 1, 2).unsqueeze(0)  # (1,T,C,H,W)
        logits = self.model(x.to(self.device))
        return DetectResult(score=float(torch.softmax(logits, -1)[0, 1].item()))
