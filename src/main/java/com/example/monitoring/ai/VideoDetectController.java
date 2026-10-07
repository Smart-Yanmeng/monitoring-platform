package com.example.monitoring.ai;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Map;

/** 视频识别 HTTP 接口（纯 Java，替代原 Python FastAPI 的 /detect）。 */
@RestController
@RequestMapping("/ai")
public class VideoDetectController {

    private final VideoAnalysisService analysisService;
    private final VideoPreviewTranscoder previewTranscoder;

    public VideoDetectController(VideoAnalysisService analysisService,
                                 VideoPreviewTranscoder previewTranscoder) {
        this.analysisService = analysisService;
        this.previewTranscoder = previewTranscoder;
    }

    @PostMapping("/detect")
    public ResponseEntity<?> detect(@RequestParam("file") MultipartFile file,
                                   @RequestParam(value = "threshold", required = false) Double threshold) {
        if (file == null || file.isEmpty()) {
            // 统一用 message 字段承载可读原因（与 ApiExceptionHandler 一致）
            return ResponseEntity.badRequest()
                    .body(Map.of("ok", false, "message", "请上传视频文件"));
        }
        if (!analysisService.isReady()) {
            return ResponseEntity.status(503)
                    .body(Map.of("ok", false, "message",
                            "AI 模型未就绪，请先按 scripts/export_onnx.py 导出 ONNX 权重"));
        }
        try {
            DetectResultDto result = analysisService.scanUploadedVideo(file, threshold);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(500)
                    .body(Map.of("ok", false, "message", String.valueOf(e.getMessage())));
        }
    }

    /**
     * 预览转码接口：把 AVI 等浏览器无法原生播放的封装转成 MP4(H.264) 回传。
     *
     * <p>前端在本地预览失败（&lt;video&gt; 报解码错误）时调用本接口，
     * 拿到可播放的 MP4 后即可原生预览，无需在浏览器端引入 ffmpeg.wasm。
     *
     * <p>手写响应而非 {@code ResponseEntity}：需要在流写完后再删除临时文件，
     * 且 {@code ResponseEntity<?>} 的通配符泛型无法让 Spring 识别流式响应体
     * 的转换器（会抛 HttpMessageNotWritableException）。
     */
    @PostMapping("/preview")
    public void preview(@RequestParam("file") MultipartFile file,
                        HttpServletResponse resp) throws IOException {
        if (file == null || file.isEmpty()) {
            writeError(resp, 400, "请上传视频文件");
            return;
        }

        // 源文件需落盘：FFmpegFrameGrabber 只能从文件读取
        Path source = Files.createTempFile("preview-src-", "-" + safeExt(file.getOriginalFilename()));
        try {
            Files.copy(file.getInputStream(), source, StandardCopyOption.REPLACE_EXISTING);

            VideoPreviewTranscoder.Result result =
                    previewTranscoder.toPlayable(source.toFile(), file.getOriginalFilename());
            File payload = result.file();

            resp.setStatus(HttpServletResponse.SC_OK);
            // 直接写 Content-Type 头：setContentType + setCharacterEncoding 组合
            // 会产出 "video/mp4;charset=" 这类畸形值，部分浏览器会拒绝播放
            resp.setHeader("Content-Type", result.mime());
            resp.setContentLengthLong(payload.length());
            resp.setHeader("Cache-Control", "no-store");
            resp.setHeader("X-Preview-Converted", String.valueOf(result.converted()));
            resp.setHeader("X-Preview-Elapsed-Ms", String.valueOf(result.elapsedMillis()));

            try (InputStream in = Files.newInputStream(payload.toPath())) {
                in.transferTo(resp.getOutputStream());
                resp.flushBuffer();
            } finally {
                // 产物（含其所在目录）与源文件用完即删
                File dir = result.dir();
                if (dir != null) {
                    VideoPreviewTranscoder.deleteQuietly(dir);
                } else {
                    deleteQuietly(payload.toPath());
                }
                if (!source.equals(payload.toPath())) {
                    deleteQuietly(source);
                }
            }
        } catch (IOException e) {
            deleteQuietly(source);
            // 响应尚未开始写出，可安全返回 JSON 错误
            writeError(resp, 500, "视频转码失败: " + e.getMessage());
        }
    }

    private static void writeError(HttpServletResponse resp, int status, String message)
            throws IOException {
        resp.setStatus(status);
        resp.setCharacterEncoding("UTF-8");
        resp.setContentType("application/json;charset=UTF-8");
        // 统一用 message 字段承载可读原因（与 ApiExceptionHandler 一致）
        resp.getWriter().write(
                "{\"ok\":false,\"message\":\"" + message.replace("\"", "'") + "\"}");
    }

    private static String safeExt(String name) {
        if (name == null) return "mp4";
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase();
        return ext.matches("[a-z0-9]{1,5}") ? ext : "mp4";
    }

    private static void deleteQuietly(Path p) {
        if (p == null) return;
        try {
            Files.deleteIfExists(p);
        } catch (IOException ignored) {
            // 临时文件清理失败可忽略
        }
    }
}
