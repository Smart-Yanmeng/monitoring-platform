package com.example.monitoring.ai;

import com.example.monitoring.service.AlarmService;
import com.example.monitoring.service.AiStatusStore;
import com.example.monitoring.service.DeviceService;
import com.example.monitoring.service.ModelService;
import com.example.monitoring.web.dto.AlarmRaiseRequest;
import com.example.monitoring.web.dto.CameraStatusDto;
import com.example.monitoring.web.dto.DeviceDto;
import jakarta.annotation.PreDestroy;
import org.bytedeco.javacv.Frame;
import org.bytedeco.javacv.FFmpegFrameGrabber;
import org.bytedeco.javacv.Java2DFrameConverter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.awt.image.BufferedImage;
import java.io.File;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * 纯 Java 实时打架检测服务：
 *  - 应用启动后拉取「启用模型」并加载 ONNX（无 Python 依赖）；
 *  - 轮询摄像头列表，为每个 RTSP 摄像头起独立线程抽帧推理；
 *  - 命中打架且超过置信度阈值、并满足冷却时间时，直接调用 AlarmService 落库；
 *  - 周期性把模型/摄像头状态写入 AiStatusStore，供前端 AI 状态页读取；
 *  - 上传视频走 scanUploadedVideo，供「视频识别」页使用。
 */
@Service
public class VideoAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(VideoAnalysisService.class);

    /** 最新帧缓存的降采样间隔：每 N 个解码帧存一帧（约 5~8fps 足够预览） */
    private static final int PREVIEW_FRAME_SKIP = 3;

    private final AiProperties props;
    private final AlarmService alarmService;
    private final DeviceService deviceService;
    private final ModelService modelService;
    private final AiStatusStore statusStore;

    private volatile YoloOnnxDetector detector;
    private volatile String activeOnnxPath;
    private final ConcurrentMap<Long, CameraWorker> workers = new ConcurrentHashMap<>();
    private final ConcurrentMap<Long, String> cameraStatus = new ConcurrentHashMap<>();
    private final ConcurrentMap<Long, Long> lastAlarm = new ConcurrentHashMap<>();
    /**
     * 各摄像头最新一帧，供「视频监控」墙以 MJPEG 方式复用推送。
     * 复用 AI 拉流线程已解码的帧，避免为预览再拉一路 RTSP（多数设备限制并发连接数）。
     */
    private final ConcurrentMap<Long, BufferedImage> latestFrames = new ConcurrentHashMap<>();
    /** 各摄像头当前生效的拉流地址，用于检测设备地址变更并重启线程 */
    private final ConcurrentMap<Long, String> workerAddress = new ConcurrentHashMap<>();

    private Thread supervisor;
    private Thread heartbeat;
    private volatile boolean running = false;

    public VideoAnalysisService(AiProperties props, AlarmService alarmService,
                                DeviceService deviceService, ModelService modelService,
                                AiStatusStore statusStore) {
        this.props = props;
        this.alarmService = alarmService;
        this.deviceService = deviceService;
        this.modelService = modelService;
        this.statusStore = statusStore;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        if (!props.isEnabled()) {
            log.info("[AI] 已禁用（app.ai.enabled=false）");
            return;
        }
        // 始终启动轮询线程：即使启动时 ONNX 尚未就位，也会在文件出现后自动热加载
        running = true;
        supervisor = new Thread(this::supervisorLoop, "ai-supervisor");
        supervisor.setDaemon(true);
        supervisor.start();
        heartbeat = new Thread(this::heartbeatLoop, "ai-heartbeat");
        heartbeat.setDaemon(true);
        heartbeat.start();

        String path = resolveOnnxPath();
        if (path == null) {
            log.warn("[AI] 未找到 ONNX 模型，将在权重就位后自动加载。请先按 scripts/export_onnx.py 导出 .onnx 权重。");
            return;
        }
        try {
            reload(path);
            log.info("[AI] 模型加载成功: {}", path);
        } catch (Exception e) {
            log.error("[AI] 模型加载失败: {}", e.getMessage());
        }
    }

    private String resolveOnnxPath() {
        if (props.getOnnxPath() != null && !props.getOnnxPath().isBlank()) {
            return props.getOnnxPath();
        }
        return modelService.getActive()
                .map(m -> m.filePath())
                .filter(Objects::nonNull)
                .map(fp -> fp.replaceAll("\\.pt$", ".onnx"))
                .orElse(null);
    }

    private void supervisorLoop() {
        while (running) {
            try {
                String path = resolveOnnxPath();
                if (path != null && !path.equals(activeOnnxPath)) {
                    reload(path);
                }
                List<DeviceDto> cams = deviceService.list(null, "CAMERA");
                Set<Long> ids = new HashSet<>();
                for (DeviceDto cam : cams) {
                    Long id = cam.id();
                    ids.add(id);
                    String addr = cam.address();
                    if (addr == null || addr.isBlank()) {
                        cameraStatus.put(id, "NO_ADDRESS");
                        continue;
                    }
                    CameraWorker w = workers.get(id);
                    // 地址变更也要重建线程，否则改了设备地址后拉流线程仍用旧地址反复重试
                    boolean addressChanged = !Objects.equals(workerAddress.get(id), addr);
                    if (w == null || !w.isAlive() || addressChanged) {
                        if (w != null) {
                            w.stopGracefully();
                            log.info("[AI] 摄像头 {} 地址变更，重启拉流线程", cam.name());
                        }
                        CameraWorker nw = new CameraWorker(id, cam.regionId(), addr, cam.name());
                        workers.put(id, nw);
                        workerAddress.put(id, addr);
                        nw.start();
                    }
                }
                for (Iterator<Long> it = workers.keySet().iterator(); it.hasNext(); ) {
                    Long id = it.next();
                    if (!ids.contains(id)) {
                        CameraWorker w = workers.get(id);
                        if (w != null) w.stopGracefully();
                        it.remove();
                        workerAddress.remove(id);
                        latestFrames.remove(id);
                        cameraStatus.remove(id);
                    }
                }
            } catch (Exception e) {
                log.warn("[AI] 巡检异常: {}", e.getMessage());
            }
            try {
                Thread.sleep(props.getPollIntervalSeconds() * 1000L);
            } catch (InterruptedException ie) {
                break;
            }
        }
    }

    private void reload(String path) {
        try {
            YoloOnnxDetector nd = YoloOnnxDetector.load(path, props.getInputSize(),
                    props.getFightClassIndex(), (float) props.getConfThreshold());
            YoloOnnxDetector old = detector;
            detector = nd;
            activeOnnxPath = path;
            if (old != null) old.close();
            log.info("[AI] 模型热加载成功: {}", path);
        } catch (Exception e) {
            log.warn("[AI] 模型热加载失败，继续使用旧模型: {}", e.getMessage());
        }
    }

    private void heartbeatLoop() {
        while (running) {
            try {
                List<CameraStatusDto> list = new ArrayList<>();
                for (Map.Entry<Long, String> e : cameraStatus.entrySet()) {
                    list.add(new CameraStatusDto(e.getKey(), e.getValue()));
                }
                statusStore.mark(activeOnnxPath, list);
            } catch (Exception ignored) {
            }
            try {
                Thread.sleep(props.getHeartbeatIntervalSeconds() * 1000L);
            } catch (InterruptedException ie) {
                break;
            }
        }
    }

    public boolean isReady() {
        return detector != null;
    }

    @PreDestroy
    public void destroy() {
        running = false;
        for (CameraWorker w : workers.values()) {
            w.stopGracefully();
        }
        if (supervisor != null) supervisor.interrupt();
        if (heartbeat != null) heartbeat.interrupt();
        if (detector != null) detector.close();
        log.info("[AI] 已停止");
    }

    /** 上传视频扫描：抽帧打分，返回前端需要的 DetectResult。 */
    public DetectResultDto scanUploadedVideo(MultipartFile file, Double threshold) throws Exception {
        if (detector == null) {
            throw new IllegalStateException("AI 模型未就绪");
        }
        File tmp = File.createTempFile("ai-detect-", ".mp4");
        try {
            file.transferTo(tmp);
            return scanFile(tmp, file.getOriginalFilename(), threshold);
        } finally {
            tmp.delete();
        }
    }

    private DetectResultDto scanFile(File video, String filename, Double threshold) throws Exception {
        FFmpegFrameGrabber grabber = new FFmpegFrameGrabber(video);
        grabber.start();
        double fps = grabber.getFrameRate();
        if (fps <= 0 || Double.isNaN(fps)) {
            fps = 25;
        }
        int step = Math.max(1, (int) Math.round(fps / props.getSampleFps()));
        Java2DFrameConverter converter = new Java2DFrameConverter();
        List<Float> scores = new ArrayList<>();
        long idx = 0;
        Frame frame;
        while ((frame = grabber.grabImage()) != null) {
            if (idx % step == 0 && scores.size() < props.getMaxVideoFrames()) {
                BufferedImage img = converter.convert(frame);
                if (img != null) {
                    scores.add(detector.detectBest(img));
                }
            }
            idx++;
        }
        grabber.stop();
        grabber.close();

        if (scores.isEmpty()) {
            throw new IllegalStateException("视频解析不到任何帧");
        }
        double th = threshold != null ? threshold : props.getConfThreshold();
        double maxScore = 0;
        int fightFrames = 0;
        for (float s : scores) {
            if (s > maxScore) maxScore = s;
            if (s >= th) fightFrames++;
        }
        List<DetectResultDto.TimelinePoint> timeline = buildTimeline(scores, step, fps);
        return new DetectResultDto(true, filename, scores.size(), maxScore,
                maxScore >= th, fightFrames, th, timeline);
    }

    private List<DetectResultDto.TimelinePoint> buildTimeline(List<Float> scores, int step, double fps) {
        int n = scores.size();
        int target = 80;
        List<DetectResultDto.TimelinePoint> out = new ArrayList<>();
        if (n > target) {
            double takeEvery = (double) n / target;
            for (int i = 0; i < target; i++) {
                int k = (int) (i * takeEvery);
                double t = Math.round((k * step) / fps * 100.0) / 100.0;
                out.add(new DetectResultDto.TimelinePoint(t, round4(scores.get(k))));
            }
        } else {
            for (int k = 0; k < n; k++) {
                double t = Math.round((k * step) / fps * 100.0) / 100.0;
                out.add(new DetectResultDto.TimelinePoint(t, round4(scores.get(k))));
            }
        }
        return out;
    }

    private static double round4(float v) {
        return Math.round(v * 10000.0) / 10000.0;
    }

    /** 取某摄像头的最新帧（视频墙 MJPEG 推送用）；无帧时返回 null */
    public BufferedImage latestFrame(long deviceId) {
        return latestFrames.get(deviceId);
    }

    /** 单路摄像头抽帧推理线程 */
    class CameraWorker extends Thread {
        private final long deviceId;
        private final Long regionId;
        private final String address;
        private final String name;
        private volatile boolean running = true;

        CameraWorker(long deviceId, Long regionId, String address, String name) {
            super("ai-cam-" + deviceId);
            this.deviceId = deviceId;
            this.regionId = regionId;
            this.address = address;
            this.name = name;
            setDaemon(true);
        }

        void stopGracefully() {
            running = false;
            this.interrupt();
        }

        @Override
        public void run() {
            cameraStatus.put(deviceId, "STARTING");
            while (running && VideoAnalysisService.this.running) {
                FFmpegFrameGrabber grabber = null;
                try {
                    grabber = new FFmpegFrameGrabber(address);
                    grabber.setOption("rtsp_transport", "tcp");
                    grabber.start();
                    Java2DFrameConverter converter = new Java2DFrameConverter();
                    cameraStatus.put(deviceId, "RUNNING");
                    log.info("[AI] 摄像头 {} 拉流: {}", name, address);
                    long idx = 0;
                    Frame frame;
                    while (running && VideoAnalysisService.this.running) {
                        frame = grabber.grabImage();
                        if (frame == null) {
                            break;
                        }
                        idx++;
                        // 无论是否推理都刷新最新帧，保证视频墙预览实时（预览不需推理，降采样以省 CPU）
                        if (idx % PREVIEW_FRAME_SKIP == 0) {
                            BufferedImage preview = converter.convert(frame);
                            if (preview != null) {
                                latestFrames.put(deviceId, preview);
                            }
                        }
                        if (idx % props.getFrameSkip() != 0) {
                            continue;
                        }
                        BufferedImage img = converter.convert(frame);
                        if (img == null) {
                            continue;
                        }
                        YoloOnnxDetector d = detector;
                        if (d == null) {
                            continue;
                        }
                        float score = d.detectBest(img);
                        if (score >= props.getConfThreshold()) {
                            long now = System.currentTimeMillis();
                            long last = lastAlarm.getOrDefault(deviceId, 0L);
                            if (now - last >= props.getCooldownSeconds() * 1000L) {
                                lastAlarm.put(deviceId, now);
                                try {
                                    alarmService.raise(new AlarmRaiseRequest(deviceId, null, "打架", "CRITICAL"));
                                    log.info("[AI][ALARM] 摄像头 {} 检测到打架，置信度 {}", name, score);
                                } catch (Exception ex) {
                                    log.warn("[AI] 报警落库失败: {}", ex.getMessage());
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    cameraStatus.put(deviceId, "OFFLINE");
                    latestFrames.remove(deviceId);
                    log.warn("[AI] 摄像头 {} 拉流异常: {}", name, e.getMessage());
                } finally {
                    if (grabber != null) {
                        try {
                            grabber.stop();
                            grabber.close();
                        } catch (Exception ignore) {
                        }
                    }
                }
                if (!running || !VideoAnalysisService.this.running) {
                    break;
                }
                latestFrames.remove(deviceId);
                try {
                    Thread.sleep(2000);
                } catch (InterruptedException ie) {
                    break;
                }
            }
            cameraStatus.put(deviceId, "OFFLINE");
        }
    }
}
