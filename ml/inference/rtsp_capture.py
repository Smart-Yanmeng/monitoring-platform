"""RTSP 视频流抽帧生成器。"""
from __future__ import annotations

import cv2


def rtsp_frames(url: str, sample_fps: int = 5):
    """按 sample_fps 均匀抽帧，逐帧 yield numpy 数组。"""
    cap = cv2.VideoCapture(url)
    if not cap.isOpened():
        raise RuntimeError(f"无法打开 RTSP: {url}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    step = max(1, int(round(fps / sample_fps)))
    idx = 0
    try:
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            if idx % step == 0:
                yield fr
            idx += 1
    finally:
        cap.release()
