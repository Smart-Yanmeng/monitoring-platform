# 打架识别模型 (Fight Detection)

本目录是监控平台的 **Python 训练 / 推理模块**，与 Spring 后端、React 前端解耦。
目标：从监控视频（RTSP / 文件）中识别「人-人打架」行为，命中后把报警推送给后端 `Alarm` 接口，再在大屏 `VideoWall` 实时展示。

## 一、方案

采用**两阶段**（精度与 16G 显存的最佳平衡）：

1. **感知前端**：`YOLOv11-pose`（`yolo11s-pose.pt`）检测人并输出 17 关键点骨骼，
   每帧保留面积最大的 **top-2 人**（打架本质是两人的交互，只用单人会丢信息）。
2. **时序分类头**：对关键点序列（滑动窗口 32 帧）用 **Bi-LSTM** 分类是否打架。
   每人每关键点特征 = `(x, y, score, vx, vy, 0)`：(x,y) 归一化(居中骨盆/按肩宽缩放)，
   (vx,vy) 为帧间速度，直接刻画「运动剧烈程度」。总特征维 = 2×17×6 = 204。

> 想要更高成功率（约 89–91%，仍在 16G 内）：把 YOLO 检测出的「人」crop 出来喂给
> `VideoMAE-Base` / `SlowFast-R50` 做分类（两阶段全帧），见 `configs/default.yaml` 的 `model.temporal` 注释。

### 实测结果（RWF-2000，val 400 段）

| 版本 | 骨骼 | 输入 | 最佳 val F1 | val Acc |
|---|---|---|---|---|
| v1 | yolo11n-pose | 单人 51 维 | 0.727 | 0.73 |
| **v2** | **yolo11s-pose** | **top-2 人 204 维 + 速度 + 增强** | **0.826** | **0.80** |

v2 权重：`data/checkpoints/fight_lstm.pt`（v1 备份为 `fight_lstm_v1_51d.pt`，无预训练备份 `fight_lstm_v2_nopretrain.pt`）。
真实视频端到端校验：打架片段概率 0.88/0.73/0.86/0.84，非打架 0.02–0.38，分离良好。

### 方案2：YOLO 裁剪人体 + 2D CNN 时序分类（RGB）

`scripts/extract_clips.py` 用 YOLO 检测人 -> 裁剪「人所在区域」(片段内所有人框并集) -> `data/clips/`。
`train_rgb.py` 用 **ImageNet 预训练 ResNet18 逐帧提特征 + mean/max 时序池化** 微调。

> **重要坑**：最初计划用 torchvision 的 3D 骨干 (R(2+1)D / SlowFast)。但实测在当前
> CUDA + Blackwell(sm_120) 组合下，**3D 卷积退化为极慢路径**（batch4 前反向 >14s，一轮训练 20+ 分钟，
> 表现为「卡死」）。改用 2D CNN 逐帧(帧当 batch)后，同样输入仅 0.62s（**快 ~25 倍**），显存也更省。
> 若你的环境是较老的 GPU/A100 等，3D 骨干可能反而更合适，`models/video_classifier.py` 有历史实现可参考。

### 三方案对比（RWF-2000 val 400 段）

| 方案 | 输入模态 | val Acc | val F1 |
|---|---|---|---|
| 骨架 Bi-LSTM（方案1 v2） | 32 帧关键点 | 0.815 | 0.826 |
| RGB ResNet18（方案2） | 16 帧裁剪图 | 0.818 | 0.828 |
| **集成（骨架 + RGB 概率平均）** | 两模态 | **0.855** | **0.863** |

集成以 0.5 概率融合：`(骨架分 + RGB分) / 2`。两模态互补，融合后 F1 提升约 +0.035。
**推理服务 `inference/service.py` 默认已使用集成**（`EnsembleFightDetector`），任一权重缺失时自动降级为可用单模态。

### 多数据集扩展（v3，推荐）

RWF-2000 仅 2000 段，规模与场景多样性都不足。已接入三个公开数据集构成 **4800 段**训练集：

| 数据集 | 规模 | 来源 | 说明 |
|---|---|---|---|
| RWF-2000 | 2000 | 保持原有 | 通用现实场景 |
| Hockey Fight | 1000 | HF `34data/hockey-fight-videos` | 冰球赛场冲突（`fi_`/`no_` 命名即标签） |
| Real-Life Violence (RLVS) | 1500 | HF `34data/real-life-violence` | 现实暴力/非暴力 |
| Surveillance (surv) | 300 | 自有/补充监控片段 | 监控视角，补充域多样性 |
| UCF-Crime (ucf) | 100 | HF `jinmang2/ucf_crime` (CC0) | **真实 CCTV**：Fighting 50 + Normal 50；用于长视频滑窗修复的评测基准 |

一键接入（解压 -> 规整目录 -> 生成带前缀的 manifest，避免跨集重名）：

```bash
python -m scripts.prepare_external --name hockey --zip-dir data/raw/_dl --pattern 'data_*.zip' \
       --out-dir data/raw/hockey --manifest data/manifests/hockey.csv
python -m scripts.prepare_external --name rlvs --zip-dir data/raw/_dl --pattern 'real-life-violence_*.zip' \
       --out-dir data/raw/rlvs --manifest data/manifests/rlvs.csv
python -m scripts.prepare_external --merge data/manifests/rwf2000.csv data/manifests/hockey.csv \
       data/manifests/rlvs.csv data/manifests/surv.csv --manifest data/manifests/all_train.csv
# 抽关键点/片段(已有数据自动跳过)，再训练
python -m scripts.extract_keypoints --manifest data/manifests/all_train.csv --out data/keypoints
python -m scripts.extract_clips     --manifest data/manifests/all_train.csv --out data/clips
python -m train     --manifest data/manifests/all_train.csv --class-weight
python -m train_rgb --manifest data/manifests/all_train.csv --class-weight
```

**注意**：跨数据集合并后，val 集混合了多个域，指标与「RWF-only val」不可直接比较。
用 `python -m eval --manifest data/manifests/all_train.csv` 按域拆分评估，才是诚实结论。

#### v3 实测（val 820 段 = RWF 400 + Hockey 150 + RLVS 225 + surv 45，按域拆分）

| 模型 | RWF F1 | Hockey F1 | RLVS F1 | surv F1 | 整体 F1 |
|---|---|---|---|---|---|
| 骨架 Bi-LSTM | 0.800 | 0.862 | 0.940 | 0.703 | 0.854 |
| RGB ResNet18 | 0.844 | 0.989 | 0.984 | 0.723 | 0.911 |
| **集成 w_sk=0.4** | **0.862** | **0.994** | **0.990** | **0.791** | **0.926** |

对比 v2（RWF-only，F1 0.863）：整体 **0.863 -> 0.926**；RWF 域本身也从 0.826 -> 0.862。
**一个诚实的发现**：多域混合训练后，*骨架单模态*在 RWF 域上从 0.826 略降到 0.800
（跨域模式稀释），但 RGB 分支与集成反而都更强——所以生产默认走集成已无影响。
最优融合权重由 0.5 调为 **0.4**（`skeleton_weight`/`FIGHT_SKELETON_WEIGHT`）。
当前短板是 `surv` 域（样本仅 45），后续补监控视角数据优先。

#### surv 域定向优化的负面结论（已尝试，均无效）

对 `surv` 域（IPTA 2019 监控打架数据集，150 fight + 150 nofight）做过一轮定向诊断，
**结论：现有数据规模下无法可靠提升该域，生产保持基础版不改**。已排除的方法：

| 方法 | surv F1 变化 | 整体 F1 变化 | 是否采纳 |
|---|---|---|---|
| 温度校准（train 拟合 / val 验证） | 0 | 0 | ✗ 单模态 F1 对温度单调不变 |
| RGB 补训 surv（4800 全集） | 0.723→0.732 | 0.9107→0.8976 | ✗ 拖累整体 |
| surv 训练集过采样 3× | 0.791→0.744 | 0.9259→0.9115 | ✗ 整体反降 |
| 融合规则：几何平均 / 取最小 / 取最大 | 均 ≤0.79 | 均下降 | ✗ 均不如算术平均 |

**根本原因**：`surv` val 仅 45 条，bootstrap 95% 置信区间宽达 ±0.15，
各融合方案的区间**完全重叠**——在该 val 上任何"提升"都无法与噪声区分。
且 `surv` 源素材已全部接入（300/300），无更多可用数据。

**下一步真正有效的方向**：不是调参或过采样，而是**补充更多监控视角的标注数据**
（不同分辨率/角度/光照的 CCTV 场景），把该域训练样本从 255 提到千级再谈优化。
实验产物归档在 `data/checkpoints/_experiments/`。

#### 长视频滑窗修复（重要，已上线）

接入 UCF-Crime（真实 CCTV，Fighting 平均时长 173s、最长 1055s）时发现一个生产缺陷：
**上传接口对长视频"均匀抽 32 帧撒满全长"，会把只占几秒的打架片段稀释掉而漏检。**

修复：`inference/service.py` 的上传接口改为 **`load_frames`(按 5fps 抽帧) → `iter_windows`(切 32 帧滑窗) → 取各窗口最大分**。
短视频退化为单窗口，行为不变。

| 评测(UCF val 20 段, 11 正/9 负) | acc | F1 | prec | rec |
|---|---|---|---|---|
| 修复前（均匀抽帧） | 0.850 | 0.857 | 0.900 | 0.818 |
| **修复后（滑窗取 max）** | **0.900** | **0.917** | 0.846 | **1.000** |

典型漏检案例：`Fighting002` 修复前 0.479(漏)、修复后 0.929；`Fighting012` 修复前 0.299(漏)、修复后 0.602。
短视频回归（rwf/rlvs/hockey/surv）均 `windows=1`，判定与修复前一致。
**结论**：UCF 域不是模型能力短板，模型的打架识别可泛化到 CCTV；瓶颈在**推理侧的抽帧策略**。

```bash
# 方案2 全流程
python -m scripts.extract_clips --manifest data/manifests/rwf2000.csv --out data/clips \
       --num-frames 16 --res 160
python -m train_rgb --manifest data/manifests/rwf2000.csv --clip-dir data/clips \
       --backbone resnet18 --epochs 20 --batch 32

# 集成推理服务(默认骨架+RGB, 阈值 0.5)
uvicorn inference.service:app --port 8000
# 可切换: 仅骨架 / 仅RGB / 调融合比 / 换阈值
FIGHT_CLASSIFIER_WEIGHTS="" uvicorn inference.service:app --port 8000   # 仅RGB
FIGHT_RGB_WEIGHTS="" uvicorn inference.service:app --port 8000          # 仅骨架
FIGHT_SKELETON_WEIGHT=0.6 FIGHT_THRESHOLD=0.5 uvicorn inference.service:app --port 8000
```

### 关于预训练（自监督对比学习）

已实现 SimCLR 式时序对比预训练（`pretrain.py`，NT-Xent，随机时间裁剪/重采样 + 翻转 + 抖动）。
**结论：在同域（仅用 RWF-2000 自身）数据上做预训练没有增益**，实验如下：

| 训练标签量 | 从零训练 F1 | SSL 预训练 F1 | 差异 |
|---|---|---|---|
| 100%（1600） | **0.826** | 0.798 | -0.028 |
| 20%（320） | **0.761** | 0.737 | -0.024 |

原因：预训练数据与微调数据是同一批视频，编码器未获得新信息；且 1600 条序列对 SSL 而言过少。
**预训练要有效，预训练数据必须来自当前数据之外**（如 UCF-Crime / Kinetics 等），再微调到 RWF-2000。
接入外部数据的流程：

```bash
# 1) 对新增数据抽关键点(可指向任意 manifest)
python -m scripts.extract_keypoints --manifest data/manifests/ucf_crime.csv \
       --out data/keypoints_ucf --k 2

# 2) 在(全部)外部数据上做自监督预训练
python -m pretrain --manifest data/manifests/ucf_crime.csv \
       --kp-dir data/keypoints_ucf --split "" --epochs 300 \
       --out data/checkpoints/encoder_ucf.pt

# 3) 用预训练编码器微调到 RWF-2000
python -m train --pretrain data/checkpoints/encoder_ucf.pt --epochs 40
```

## 二、数据集（已联网核实）

| 数据集 | 规模 / 说明 | 地址 |
|---|---|---|
| **RWF-2000** ⭐ | 2000 段（1000 打架/1000 非），5s，30fps，真实监控，带人体框；标杆 87.25% | GitHub: `github.com/mchengny/RWF2000-Video-Database-for-Violence-Detection`<br>OpenDataLab: `opendatalab.com/OpenDataLab/RWF-2000`<br>论文: arXiv:1911.05913 (ICPR 2021) |
| **Hockey Fight** | 1000 段（500/500），冰球比赛 | Kaggle: `hockey-fight-detection-dataset` |
| **Movies Fight** | 400 段（200/200），电影片段 | Kaggle: `movies-fight-detection` |
| **UCF-Crime** | 1900 段长视频，13 类异常含 Fighting，弱标签，128h；适合预训练 | OpenDataLab: `opendatalab.com/OpenDataLab/UCF-Crime`<br>crcv.ucf.edu/chenchen/datasets |
| **DVD (2025)** | 新的综合暴力检测数据集 | arXiv:2506.05372 |
| 参考实现 | 实时暴力检测 / 监控打架检测 | `ejaj/real-time-violence-detection`<br>`Shady-Abdelaziz/Automatic-Fight-Detection-in-Surveillance-Videos`（MobileNetV3 89% val acc） |

主力用 **RWF-2000**（监控风格 + 带框），用 UCF-Crime 预训练，再用自有监控录像标注几百条微调。
注意：打架是小概率事件，训练重点看**召回率 / F1 / ROC-AUC**，加类别权重。

## 三、目录结构

```
ml/
├── configs/default.yaml     # 路径 / 模型 / 训练 / 推理 配置
├── data/
│   ├── prepare_data.py      # 下载整理 RWF-2000，生成标注 CSV
│   └── keypoints/           # 离线抽取的骨骼关键点 *.npy (+ meta.json)
├── scripts/
│   └── extract_keypoints.py # YOLO-Pose 批量抽关键点 -> .npy
├── models/
│   ├── fight_detector.py    # 方案1: PoseExtractor + Bi-LSTM
│   ├── video_classifier.py  # 方案2: 2D CNN 帧分类器(ResNet)
│   ├── video_detector.py    # 方案2 推理封装(YOLO裁剪+CNN)
│   └── ensemble_detector.py # 骨架+RGB 集成推理
├── inference/
│   ├── rtsp_capture.py      # RTSP 抽帧
│   └── service.py           # FastAPI 推理服务(默认集成)，命中后 POST 报警
├── scripts/
│   ├── extract_keypoints.py # 方案1: YOLO-Pose 批量抽关键点
│   └── extract_clips.py     # 方案2: YOLO 检测裁剪人体 -> RGB 片段
├── train.py                 # 方案1 训练（缺关键点会自动先抽取）
├── train_rgb.py             # 方案2 训练（2D CNN 微调）
├── pretrain.py              # 自监督对比预训练(SimCLR/NT-Xent)
├── requirements.txt
└── data/checkpoints/        # fight_lstm.pt / fight_rgb_resnet18.pt / encoder_pretrained.pt
```

## 四、使用

```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1) 准备数据（先把 RWF-2000 下到 data/raw/RWF2000）
python -m data.prepare_data --src data/raw/RWF2000 --out data/manifests/rwf2000.csv

# 2) 训练（需 GPU）—— 首次会自动先抽取骨骼关键点，再训练
python -m train --num-frames 32 --k 2 --epochs 40 --batch 128 \
                --pose-weights yolo11s-pose.pt

# 也可单独先抽关键点（可复用/断点续抽）
python -m scripts.extract_keypoints --manifest data/manifests/rwf2000.csv \
       --out data/keypoints --k 2

# 3) 推理服务（对接后端报警接口，自动加载 data/checkpoints/fight_lstm.pt）
BACKEND_ALARM_URL=http://localhost:8080/api/alarms uvicorn inference.service:app --port 8000
```

## 五、与平台对接

`inference/service.py` 命中打架后向 `POST /api/alarms` 发送：

```json
{ "type": "FIGHT", "area": "校部 > 第五社区", "confidence": 0.87, "snapshotUrl": "/snapshots/xxx.jpg" }
```

后端需新增 `Alarm` 实体 + `AlarmController`（见平台对接计划）。前端 `VideoWall` 把
`MOCK_ALARMS` 换成 `GET /api/alarms` 轮询即可实时显示。
