package com.example.monitoring.ai;

import jakarta.annotation.PreDestroy;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Iterator;

/**
 * 摄像头实时画面推送（MJPEG over HTTP）。
 *
 * <p>浏览器无法直接播放 RTSP。这里复用 AI 拉流线程已解码的最新帧（见
 * {@link VideoAnalysisService#latestFrame(long)}），以 {@code multipart/x-mixed-replace}
 * 持续推 JPEG：前端只需一个 {@code <img src>}，无需任何播放器库
 * （不像 HLS 要 hls.js、WebRTC 要信令服务器）。
 *
 * <p>关键点：<b>不为预览额外拉流</b>，复用推理线程的解码结果，避免多数摄像头
 * 限制并发连接数导致两路互相抢占。
 */
@RestController
@RequestMapping("/ai/camera")
public class CameraStreamController {

    private static final Logger log = LoggerFactory.getLogger(CameraStreamController.class);

    /** multipart 分隔符 */
    private static final String BOUNDARY = "frameboundary";

    /** 推流帧率上限：过高只会白耗 CPU 做 JPEG 编码 */
    private static final int TARGET_FPS = 8;

    /** JPEG 质量：0.6 在画质/体积间比较平衡 */
    private static final float JPEG_QUALITY = 0.6f;

    private final VideoAnalysisService analysisService;

    /**
     * ImageWriter 非线程安全，而控制器是单例多线程，故用 ThreadLocal 每线程一个。
     * 这样也避免每帧都去 {@code ImageIO.getImageWritersByFormatName} 重新创建。
     */
    private final ThreadLocal<ImageWriter> jpegWriter = ThreadLocal.withInitial(() -> {
        Iterator<ImageWriter> it = ImageIO.getImageWritersByFormatName("jpg");
        if (!it.hasNext()) {
            throw new IllegalStateException("运行环境缺少 JPEG 编码器");
        }
        return it.next();
    });

    public CameraStreamController(VideoAnalysisService analysisService) {
        this.analysisService = analysisService;
    }

    /** 单帧快照，便于调试与前端在无信号时展示 */
    @GetMapping(value = "/{deviceId}/snapshot", produces = "image/jpeg")
    public void snapshot(@PathVariable long deviceId, HttpServletResponse resp) throws IOException {
        resp.setHeader("Cache-Control", "no-store");
        BufferedImage img = analysisService.latestFrame(deviceId);
        if (img == null) {
            // 204：无信号。前端据此显示占位而不是 broken image
            resp.setStatus(HttpStatus.NO_CONTENT.value());
            return;
        }
        resp.setStatus(HttpStatus.OK.value());
        resp.setContentType("image/jpeg");
        byte[] jpeg = encodeJpeg(img);
        resp.setContentLength(jpeg.length);
        resp.getOutputStream().write(jpeg);
    }

    /**
     * MJPEG 实时流：从最新帧缓存持续推送，直到客户端断开或设备掉线。
     */
    @GetMapping(value = "/{deviceId}/mjpeg")
    public void mjpeg(@PathVariable long deviceId, HttpServletResponse resp) throws IOException {
        if (analysisService.latestFrame(deviceId) == null) {
            resp.setStatus(HttpStatus.NO_CONTENT.value());
            return;
        }

        resp.setContentType("multipart/x-mixed-replace;boundary=" + BOUNDARY);
        resp.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        resp.setHeader("Pragma", "no-cache");
        // 禁用反向代理缓冲，否则多帧会被攒在一起推，导致画面卡顿
        resp.setHeader("X-Accel-Buffering", "no");

        OutputStream out = resp.getOutputStream();
        long interval = Math.max(1, 1000L / TARGET_FPS);
        try {
            // 上次推送时间戳，保证按目标帧率输出而不是按解码帧率
            long lastSent = 0;
            while (!Thread.currentThread().isInterrupted()) {
                long now = System.currentTimeMillis();
                if (now - lastSent < interval) {
                    Thread.sleep(10);
                    continue;
                }
                BufferedImage img = analysisService.latestFrame(deviceId);
                if (img == null) {
                    break; // 设备掉线，结束响应让前端重连
                }
                writePart(out, img);
                out.flush();
                lastSent = now;
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        } catch (IOException io) {
            // 浏览器主动断开属正常情况，用 debug 避免刷屏
            log.debug("[AI] 摄像头 {} 预览连接断开: {}", deviceId, io.getMessage());
        }
    }

    private void writePart(OutputStream out, BufferedImage img) throws IOException {
        byte[] jpeg = encodeJpeg(img);
        out.write(("--" + BOUNDARY + "\r\n").getBytes("UTF-8"));
        out.write("Content-Type: image/jpeg\r\n".getBytes("UTF-8"));
        out.write(("Content-Length: " + jpeg.length + "\r\n\r\n").getBytes("UTF-8"));
        out.write(jpeg);
        out.write("\r\n".getBytes("UTF-8"));
    }

    /** 编码为 JPEG 字节（每帧仅编码一次） */
    private byte[] encodeJpeg(BufferedImage img) throws IOException {
        ImageWriter writer = jpegWriter.get();
        ByteArrayOutputStream bos = new ByteArrayOutputStream(64 * 1024);
        ImageWriteParam param = writer.getDefaultWriteParam();
        if (param.canWriteCompressed()) {
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(JPEG_QUALITY);
        }
        try (ImageOutputStream ios = ImageIO.createImageOutputStream(bos)) {
            writer.setOutput(ios);
            writer.write(null, new IIOImage(img, null, null), param);
            ios.flush();
        }
        return bos.toByteArray();
    }

    @PreDestroy
    public void dispose() {
        // 线程结束后回收编码器持有的原生资源
        try {
            ImageWriter w = jpegWriter.get();
            w.dispose();
        } catch (Exception ignored) {
            // 容器关闭期，忽略
        }
        jpegWriter.remove();
    }
}
