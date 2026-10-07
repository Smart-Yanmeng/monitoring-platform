package com.example.monitoring.web;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 统一错误响应：把后端业务校验的中文原因透出到响应体。
 *
 * <p>Spring Boot 默认的 {@code DefaultErrorAttributes} 只在
 * {@code server.error.include-message=always} 时才写入 message，而
 * {@link ResponseStatusException} 的 reason 也不会稳定出现在响应里，
 * 导致前端只能看到「报警生成失败: 400」而不知道具体原因（例如
 * 「报警需关联设备或指定地区」）。这里显式输出，保证前端能拿到可读文案。
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    /** 业务校验失败：把 reason 原样返回，前端可直接展示 */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> onResponseStatus(ResponseStatusException e,
                                                                HttpServletRequest request) {
        HttpStatus status = HttpStatus.valueOf(e.getStatusCode().value());
        String reason = e.getReason();
        log.warn("[API] {} {} -> {} {}", request.getMethod(), request.getRequestURI(),
                status.value(), reason);
        return ResponseEntity.status(status).body(body(status, reason));
    }

    /** @Valid 校验失败：拼出字段级原因 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> onInvalid(MethodArgumentNotValidException e,
                                                         HttpServletRequest request) {
        String reason = e.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .orElse("请求参数不合法");
        log.warn("[API] {} {} -> 400 {}", request.getMethod(), request.getRequestURI(), reason);
        return ResponseEntity.badRequest().body(body(HttpStatus.BAD_REQUEST, reason));
    }

    private static Map<String, Object> body(HttpStatus status, String message) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("ok", false);
        map.put("status", status.value());
        map.put("error", status.getReasonPhrase());
        // message 放业务原因；前端优先读它
        map.put("message", message == null || message.isBlank() ? status.getReasonPhrase() : message);
        return map;
    }
}
