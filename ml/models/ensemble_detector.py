"""集成推理: 骨架(Bi-LSTM) + RGB(2D CNN) 概率融合。

两模态互补，验证集上概率平均把 F1 从 ~0.83 提升到 ~0.86。
任一权重缺失时自动降级为可用模态(单模态仍可正常工作)。
与单模态检测器接口一致(predict_video -> 结果对象带 .score)。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from models.fight_detector import FightDetector
from models.video_detector import RGBFightDetector


@dataclass
class EnsembleResult:
    score: float                       # 融合后的打架概率
    skeleton_score: float | None = None
    rgb_score: float | None = None
    keypoints: np.ndarray | None = None


class EnsembleFightDetector:
    def __init__(self, pose_weights: str = "yolo11s-pose.pt", num_frames: int = 32, k: int = 2,
                 skeleton_weights: str | None = None,
                 rgb_det_weights: str = "yolo11s.pt", rgb_backbone: str = "resnet18",
                 rgb_num_frames: int = 16, rgb_res: int = 160, rgb_weights: str | None = None,
                 device: str = "cuda", skeleton_weight: float = 0.4):
        self.skeleton_weight = float(skeleton_weight)
        self.skeleton = None
        self.rgb = None
        if skeleton_weights and Path(skeleton_weights).exists():
            self.skeleton = FightDetector(pose_weights=pose_weights, num_frames=num_frames, k=k,
                                          device=device, classifier_weights=skeleton_weights)
        if rgb_weights and Path(rgb_weights).exists():
            self.rgb = RGBFightDetector(det_weights=rgb_det_weights, backbone=rgb_backbone,
                                        num_frames=rgb_num_frames, res=rgb_res, device=device,
                                        classifier_weights=rgb_weights)
        if self.skeleton is None and self.rgb is None:
            raise RuntimeError("集成检测器需至少一个可用权重(骨架或 RGB)")

    def predict_video(self, frames) -> EnsembleResult:
        sk = self.skeleton.predict_video(frames) if self.skeleton else None
        rgb = self.rgb.predict_video(frames) if self.rgb else None

        if sk is not None and rgb is not None:
            w = self.skeleton_weight
            score = w * sk.score + (1.0 - w) * rgb.score
        elif sk is not None:
            score = sk.score
        else:
            score = rgb.score
        return EnsembleResult(
            score=score,
            skeleton_score=sk.score if sk is not None else None,
            rgb_score=rgb.score if rgb is not None else None,
            keypoints=sk.keypoints if sk is not None else None,
        )
