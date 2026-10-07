package com.example.monitoring.ai;

import org.bytedeco.ffmpeg.global.avcodec;
import org.bytedeco.ffmpeg.global.avutil;
import org.bytedeco.javacv.FFmpegFrameGrabber;
import org.bytedeco.javacv.FFmpegFrameRecorder;
import org.bytedeco.javacv.Frame;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 浏览器预览转码：把 AVI 等浏览器无法原生播放的封装，转成 MP4(H.264)。
 *
 * <p>背景：Chrome/Firefox/Edge 的 {@code <video>} 不支持 AVI 容器，但监控设备导出的
 * 视频大多是 AVI。这里用 JavaCV（已捆绑 ffmpeg 原生库，无需外部依赖）重编码为 H.264，
 * 前端拿到 MP4 后即可原生播放。
 *
 * <p>预览用途不需要原始规格，因此会降分辨率/降帧率以显著缩短转码耗时
 * （实测 30s 的 720p MJPEG AVI：原分辨率 10.5s → 预览规格 5.7s）。
 */
@Component
public class VideoPreviewTranscoder {

    private static final Logger log = LoggerFactory.getLogger(VideoPreviewTranscoder.class);

    /** 浏览器原生可播的容器/编码，命中则直接回传原文件不转码 */
    private static final Set<String> NATIVE_PLAYABLE = Set.of(
            "mp4", "m4v", "webm", "mov", "ogv", "ogg");

    /** 转码产物清理阈值（毫秒）：超过则按修改时间删除，避免磁盘堆积 */
    private static final long CLEANUP_TTL_MS = 10 * 60 * 1000L;

    private final AiProperties props;

    public VideoPreviewTranscoder(AiProperties props) {
        this.props = props;
    }

    /**
     * 转码结果：可直接喂给 {@code <video src>} 的文件与 MIME。
     *
     * @param file    产物文件（调用方负责删除）
     * @param mime    MIME 类型
     * @param converted 是否实际发生了转码（false 表示原样返回）
     * @param elapsedMillis 转码耗时
     */
    public record Result(File file, String mime, boolean converted, long elapsedMillis) {
        /** 转码产物所在目录（未转码时为 null）；用于响应完成后整体清理 */
        public File dir() {
            File parent = file == null ? null : file.getParentFile();
            return parent != null && parent.getName().startsWith("preview-") ? parent : null;
        }
    }

    /**
     * 把上传视频转换为浏览器可播放格式。
     *
     * @param input            已落盘的源文件
     * @param originalFilename 上传时的原始文件名，用于判断容器类型（源文件是临时名，
     *                         后缀不可靠）；为 null 时退回用 input 的文件名
     * @return 转码结果；失败时抛 IOException
     */
    public Result toPlayable(File input, String originalFilename) throws IOException {
        cleanupStale();
        String container = containerOf(originalFilename == null ? input.getName() : originalFilename);

        // 已经是浏览器可播的封装则原样返回，避免无谓的转码开销
        if (NATIVE_PLAYABLE.contains(container)) {
            return new Result(input, mimeOf(container), false, 0);
        }
        Path outDir = Files.createTempDirectory("preview-");
        File out = outDir.resolve("p-" + UUID.randomUUID() + ".mp4").toFile();
        long t0 = System.currentTimeMillis();

        FFmpegFrameGrabber grabber = new FFmpegFrameGrabber(input);
        FFmpegFrameRecorder recorder = null;
        try {
            // 让 grabber 直接产出 yuv420p，省掉 recorder 侧二次色彩空间转换
            grabber.setPixelFormat(avutil.AV_PIX_FMT_YUV420P);
            grabber.start();

            int srcW = grabber.getImageWidth();
            int srcH = grabber.getImageHeight();
            double srcFps = grabber.getFrameRate();
            if (srcW <= 0 || srcH <= 0) {
                throw new IOException("无法解析视频尺寸，可能不是有效的视频文件");
            }

            int outW = Math.min(props.getPreviewMaxWidth(), srcW);
            // 保持宽高比，且强制偶数（yuv420p 要求）
            int outH = ((int) Math.round(srcH * (outW / (double) srcW)) / 2) * 2;
            outH = Math.max(2, outH);

            double outFps = Math.min(props.getPreviewFps(),
                    srcFps > 0 ? srcFps : props.getPreviewFps());
            // 抽帧：保持时间轴不变（每 N 帧取 1 帧），避免降帧率导致视频变慢
            int skip = srcFps > 0 ? Math.max(1, (int) Math.round(srcFps / outFps)) : 1;

            recorder = new FFmpegFrameRecorder(out, outW, outH);
            recorder.setFormat("mp4");
            recorder.setVideoCodec(avcodec.AV_CODEC_ID_H264);
            recorder.setPixelFormat(avutil.AV_PIX_FMT_YUV420P);
            recorder.setFrameRate(outFps);
            recorder.setVideoBitrate(props.getPreviewVideoBitrate());
            recorder.setVideoOptions(Map.of(
                    "preset", "veryfast",
                    "tune", "zerolatency",
                    "crf", "28"));
            recorder.start();

            Frame frame;
            long idx = 0;
            int written = 0;
            while ((frame = grabber.grabImage()) != null) {
                if (idx++ % skip == 0) {
                    recorder.record(frame);
                    written++;
                }
            }

            if (written == 0) {
                throw new IOException("视频中没有可解码的帧");
            }
        } catch (Exception e) {
            // 转码失败不留下半成品
            deleteQuietly(out);
            deleteQuietly(outDir.toFile());
            throw new IOException("视频转码失败: " + e.getMessage(), e);
        } finally {
            closeQuietly(recorder);
            closeQuietly(grabber);
        }

        long elapsed = System.currentTimeMillis() - t0;
        log.info("[AI] 预览转码完成: {} -> {} ({}ms)", input.getName(), out.getName(), elapsed);
        return new Result(out, "video/mp4", true, elapsed);
    }

    /** 判断该文件是否需要转码（供调用方决定是否请求预览） */
    public boolean needsTranscode(String filename) {
        return !NATIVE_PLAYABLE.contains(containerOf(filename));
    }

    public static String mimeOf(String container) {
        return switch (container) {
            case "webm" -> "video/webm";
            case "mov" -> "video/quicktime";
            case "ogv", "ogg" -> "video/ogg";
            default -> "video/mp4";
        };
    }

    private static String containerOf(String filename) {
        int dot = filename.lastIndexOf('.');
        return dot < 0 ? "" : filename.substring(dot + 1).toLowerCase();
    }

    /**
     * 兜底清理：删除超时的转码产物目录与源文件。
     *
     * <p>正常路径下产物与源文件在响应写完后由控制器立即删除；这里只兜住
     * 「进程被杀 / 流写出异常」等导致的残留。
     */
    private void cleanupStale() {
        try {
            Path tmp = Path.of(System.getProperty("java.io.tmpdir"));
            if (!Files.isDirectory(tmp)) return;
            long deadline = System.currentTimeMillis() - CLEANUP_TTL_MS;
            try (var stream = Files.list(tmp)) {
                stream.filter(p -> {
                    String n = p.getFileName().toString();
                    return n.startsWith("preview-");
                }).forEach(p -> {
                    try {
                        if (Files.getLastModifiedTime(p).toMillis() < deadline) {
                            deleteQuietly(p.toFile());
                        }
                    } catch (IOException ignored) {
                        // 清理失败不影响主流程
                    }
                });
            }
        } catch (IOException e) {
            log.debug("[AI] 预览临时目录清理跳过: {}", e.getMessage());
        }
    }

    /** 删除文件或目录树，忽略所有异常 */
    static void deleteQuietly(File f) {
        if (f == null || !f.exists()) return;
        try {
            Files.walk(f.toPath())
                    .sorted(Comparator.reverseOrder())
                    .forEach(p -> {
                        try {
                            Files.deleteIfExists(p);
                        } catch (IOException ignored) {
                            // 忽略单个文件删除失败
                        }
                    });
        } catch (IOException ignored) {
            // 忽略
        }
    }

    private static void closeQuietly(AutoCloseable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (Exception ignored) {
            // 忽略关闭异常
        }
    }
}
