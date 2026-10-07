#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把训练好的 Ultralytics YOLO 打架检测权重 (.pt) 导出为 ONNX，
供后端纯 Java 服务（ONNX Runtime + JavaCV）直接加载推理，无需 Python 运行时。

依赖（仅在训练/导出机器上需要，不必部署到生产）：
    pip install ultralytics

用法：
    python scripts/export_onnx.py
    # 或显式指定（输入 .pt 自动在同目录生成同名 .onnx）
    python scripts/export_onnx.py ai-service/models/fight_yolo_small.pt
    python scripts/export_onnx.py ai-service/models/fight_yolo_nano.pt

导出后把 .onnx 放到后端能读到的路径即可（与后端 DataInitializer 预置的模型路径一致）：
    ai-service/models/fight_yolo_small.onnx
    ai-service/models/fight_yolo_nano.onnx
"""
import sys
import os
from ultralytics import YOLO

DEFAULT_MODELS = [
    "ai-service/models/fight_yolo_small.pt",
    "ai-service/models/fight_yolo_nano.pt",
]


def export_one(pt_path: str):
    if not os.path.exists(pt_path):
        print(f"[skip] 文件不存在: {pt_path}")
        return
    print(f"[export] {pt_path}")
    model = YOLO(pt_path)
    # imgsz 需与后端 app.ai.input-size 一致（默认 640）
    out = model.export(format="onnx", imgsz=640, simplify=True, dynamic=False, opset=17)
    print(f"[ok] 已导出: {out}")


def main():
    paths = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_MODELS
    for p in paths:
        export_one(p)


if __name__ == "__main__":
    main()
