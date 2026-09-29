"""外部数据集接入: 解压 / 规整目录 / 生成统一 manifest(带数据集前缀防重名)。

支持:
- Hockey Fight  (data_00N.zip, 文件名 fi*=打架 no*=非打架)
- Real-Life Violence (real-life-violence_000N.zip, Violence/ 与 NonViolence/)
- SURV (git 仓库目录 fight/ 与 noFight/, 文件名 fi*/nofi*)

输出目录约定(与 RWF-2000 一致):
  data/raw/<name>/{train,val}/{fight,nonfight}/<name>__<orig_stem>.<ext>
清单 CSV 列与 rwf2000.csv 保持一致: video_path,label,split

用法:
  python -m scripts.prepare_external --name hockey --zip-dir data/raw/_dl \
         --out-dir data/raw/hockey --manifest data/manifests/hockey.csv
  python -m scripts.prepare_external --name rlvs --zip-dir data/raw/_dl --pattern 'real-life-violence_*.zip' \
         --out-dir data/raw/rlvs --manifest data/manifests/rlvs.csv
  # 目录源(git 仓库): SURV
  python -m scripts.prepare_external --name surv --src-dir data/raw/surv \
         --out-dir data/raw/surv_ready --manifest data/manifests/surv.csv
  # 合并所有清单为一个训练清单
  python -m scripts.prepare_external --merge data/manifests/rwf2000.csv data/manifests/hockey.csv \
         data/manifests/rlvs.csv --manifest data/manifests/all_train.csv
"""
from __future__ import annotations

import argparse
import csv
import random
import shutil
import zipfile
from pathlib import Path

VIDEO_EXT = (".avi", ".mp4", ".mkv", ".mov", ".flv")


def _hockey_label(name: str) -> int | None:
    """Hockey Fight: 文件名 fi* -> 打架(1); no* -> 非打架(0)。"""
    low = name.lower()
    if low.startswith("fi"):
        return 1
    if low.startswith("no"):
        return 0
    return None


def _rlvs_label(path_in_zip: str) -> int | None:
    """RLVS: 顶层目录 Violence/ 与 NonViolence/。"""
    top = path_in_zip.replace("\\", "/").split("/")[0].lower()
    if top.startswith("nonviolence"):
        return 0
    if top.startswith("violence"):
        return 1
    return None


def _surv_label(rel: str) -> int | None:
    """SURV: 目录 fight/ 与 noFight/ 即标签(比文件名前缀更可靠)。"""
    parts = [p.lower() for p in rel.replace("\\", "/").split("/")]
    if "nofight" in parts:
        return 0
    if "fight" in parts:
        return 1
    return None


def _ucf_label(rel: str) -> int | None:
    """UCF-Crime: 子目录 Fighting/ -> 打架(1); Normal* -> 非打架(0); 其它异常类忽略。"""
    parts = [p.lower() for p in rel.replace("\\", "/").split("/")]
    for p in parts:
        if p == "fighting":
            return 1
        if p.startswith("normal"):
            return 0
    return None


def _label_of(name: str, rel: str) -> int | None:
    if name == "rlvs":
        return _rlvs_label(rel)
    if name == "surv":
        return _surv_label(rel)
    if name == "ucf":
        return _ucf_label(rel)
    if name == "hockey":
        return _hockey_label(Path(rel).name)
    low = Path(rel).name.lower()
    if low[:2] not in ("fi", "no"):
        return None
    return _hockey_label(low)


def _collect_from_zips(zip_dir: str, pattern: str, name: str,
                       exclude: str | None = None) -> list[tuple[Path, str]]:
    zips = sorted(Path(zip_dir).glob(pattern))
    if exclude:
        zips = [z for z in zips if exclude not in z.name]
    good = []
    for z in zips:  # 跳过损坏/未下载完的压缩包，避免整体失败
        try:
            with zipfile.ZipFile(z) as zf:
                zf.namelist()
            good.append(z)
        except Exception:
            print(f"==> 跳过不可用压缩包 {z.name}", flush=True)
    if not good:
        raise SystemExit(f"未找到可用压缩包: {zip_dir}/{pattern}")
    tmp = Path(zip_dir) / "_extract_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    for z in good:
        print(f"==> 解压 {z.name}", flush=True)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(tmp)
    return [(p, str(p.relative_to(tmp))) for p in tmp.rglob("*")
            if p.is_file() and p.suffix.lower() in VIDEO_EXT]


def _collect_from_dir(src_dir: str) -> list[tuple[Path, str]]:
    root = Path(src_dir)
    if not root.exists():
        raise SystemExit(f"目录不存在: {src_dir}")
    return [(p, str(p.relative_to(root))) for p in sorted(root.rglob("*"))
            if p.is_file() and p.suffix.lower() in VIDEO_EXT]


def _finalize(name: str, collected: list[tuple[Path, str]], out_dir: str, manifest: str,
              val_ratio: float, seed: int, cleanup: Path | None = None) -> None:
    items: list[tuple[Path, int]] = []
    for p, rel in collected:
        lab = _label_of(name, rel)
        if lab is None:
            print("  跳过无法判定标签:", rel, flush=True)
            continue
        items.append((p, lab))
    if not items:
        raise SystemExit("未解析到任何带标签视频")

    out = Path(out_dir)
    rng = random.Random(seed)
    rng.shuffle(items)
    n_val = int(len(items) * val_ratio)
    rows = []
    for i, (p, lab) in enumerate(items):
        split = "val" if i < n_val else "train"
        cls = "fight" if lab == 1 else "nonfight"
        dst = out / split / cls / f"{name}__{p.stem}{p.suffix.lower()}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)
        rows.append((str(dst.resolve()), lab, split))
    if cleanup is not None:
        shutil.rmtree(cleanup, ignore_errors=True)

    mpath = Path(manifest)
    mpath.parent.mkdir(parents=True, exist_ok=True)
    with mpath.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["video_path", "label", "split"])
        w.writerows(sorted(rows, key=lambda r: (r[2], r[1], r[0])))
    n_fight = sum(1 for r in rows if r[1] == 1)
    print(f"DONE {name}: total={len(rows)} fight={n_fight} nonfight={len(rows)-n_fight} "
          f"-> {mpath}  (目录 {out})", flush=True)


def extract(name: str, zip_dir: str, pattern: str, out_dir: str,
            manifest: str, val_ratio: float = 0.15, seed: int = 42,
            exclude: str | None = None) -> None:
    collected = _collect_from_zips(zip_dir, pattern, name, exclude)
    _finalize(name, collected, out_dir, manifest, val_ratio, seed,
              cleanup=Path(zip_dir) / "_extract_tmp")


def extract_dir(name: str, src_dir: str, out_dir: str, manifest: str,
                val_ratio: float = 0.15, seed: int = 42) -> None:
    collected = _collect_from_dir(src_dir)
    _finalize(name, collected, out_dir, manifest, val_ratio, seed)


def merge(manifests: list[str], out_manifest: str) -> None:
    """合并清单。

    去重键用**完整路径**而非 basename: RWF-2000 的 train/fight/x.avi 与
    train/nonfight/x.avi 是内容不同的同名文件(官方命名), 按 basename 去重会静默丢数据。
    """
    rows = []
    seen = set()
    for m in manifests:
        for r in csv.DictReader(open(m, encoding="utf-8")):
            key = str(Path(r["video_path"]).resolve())
            if key in seen:
                continue
            seen.add(key)
            rows.append((r["video_path"], int(r["label"]), r["split"]))
    p = Path(out_manifest)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["video_path", "label", "split"])
        w.writerows(rows)
    import collections
    cnt = collections.Counter((r[2], r[1]) for r in rows)
    print(f"MERGED total={len(rows)} -> {p}", flush=True)
    for k in sorted(cnt):
        print(f"  split={k[0]} label={k[1]}: {cnt[k]}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default=None, help="hockey | rlvs | surv | 其它自定义")
    ap.add_argument("--zip-dir", default="data/raw/_dl")
    ap.add_argument("--src-dir", default=None, help="目录源(git 仓库), 与 --zip-dir 二选一")
    ap.add_argument("--pattern", default=None, help="压缩包通配(默认 <name>*_*.zip 或 data_*.zip)")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--val-ratio", type=float, default=0.15)
    ap.add_argument("--exclude", default=None, help="排除名字含该子串的分片")
    ap.add_argument("--merge", nargs="*", default=None, help="合并这些清单")
    args = ap.parse_args()

    if args.merge is not None:
        merge(args.merge, args.manifest or "data/manifests/all_train.csv")
        return

    if not args.name:
        raise SystemExit("需指定 --name 或 --merge")
    out_dir = args.out_dir or f"data/raw/{args.name}"
    manifest = args.manifest or f"data/manifests/{args.name}.csv"
    if args.src_dir:
        extract_dir(args.name, args.src_dir, out_dir, manifest, args.val_ratio)
        return
    pattern = args.pattern
    if not pattern:
        pattern = "data_*.zip" if args.name == "hockey" else f"{args.name}*.zip"
    extract(args.name, args.zip_dir, pattern, out_dir, manifest, args.val_ratio, exclude=args.exclude)


if __name__ == "__main__":
    main()
