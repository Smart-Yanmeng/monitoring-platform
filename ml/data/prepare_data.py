"""准备 RWF-2000 等打架数据集，生成训练用标注 CSV。

RWF-2000 官方仓库: https://github.com/mchengny/RWF2000-Video-Database-for-Violence-Detection
OpenDataLab 镜像: https://opendatalab.com/OpenDataLab/RWF-2000

目录约定（官方已分好 train/val，fight/nonfight 子目录即标签）:
  data/raw/RWF2000/<train|val>/<fight|nonfight>/*.flv

用法:
  python -m data.prepare_data --src data/raw/RWF2000 --out data/manifests/rwf2000.csv
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path


def iter_videos(root: Path):
    exts = ("*.flv", "*.avi", "*.mp4", "*.mov")
    for split in ("train", "val"):
        split_dir = root / split
        if not split_dir.exists():
            split_dir = root  # 退回扁平结构
        for label_name, label in (("fight", 1), ("nonfight", 0)):
            cls_dir = split_dir / label_name
            if not cls_dir.exists():
                continue
            for pat in exts:
                for vp in sorted(cls_dir.glob(pat)):
                    yield vp, label, split


def build_csv(src: str, out: str) -> None:
    root = Path(src)
    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = list(iter_videos(root))
    if not rows:
        raise SystemExit(f"未在 {src} 找到 fight/nonfight 视频，请先下载数据集")
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["video_path", "label", "split"])
        for vp, label, split in rows:
            w.writerow([str(vp.resolve()), label, split])
    print(f"已写出 {len(rows)} 条 -> {out_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/raw/RWF2000")
    ap.add_argument("--out", default="data/manifests/rwf2000.csv")
    args = ap.parse_args()
    build_csv(args.src, args.out)


if __name__ == "__main__":
    main()
