package com.example.monitoring.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 解密前端提交的加密载荷，并做时间戳/随机数校验，防止密文被重放。
 *
 * 载荷格式：{"p":"密码","t":时间戳,"n":"随机数"}
 */
@Service
public class EncryptedPayloadService {

    /** 允许的时钟偏差 */
    private static final long MAX_SKEW_MILLIS = 5 * 60 * 1000L;
    /** 随机数保留时长 */
    private static final long NONCE_TTL_MILLIS = 10 * 60 * 1000L;

    private final RsaKeyService rsaKeyService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ConcurrentHashMap<String, Long> usedNonces = new ConcurrentHashMap<>();

    public EncryptedPayloadService(RsaKeyService rsaKeyService) {
        this.rsaKeyService = rsaKeyService;
    }

    public String extractPassword(String cipher, String keyId) {
        if (keyId == null || !keyId.equals(rsaKeyService.getKeyId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密钥已更新，请重新获取公钥");
        }
        String json;
        try {
            json = rsaKeyService.decrypt(cipher);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密文解密失败");
        }

        Map<String, Object> payload;
        try {
            payload = objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密文格式错误");
        }

        String password = (String) payload.get("p");
        Number timestamp = (Number) payload.get("t");
        String nonce = (String) payload.get("n");
        if (password == null || password.isEmpty() || timestamp == null || nonce == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密文缺少必要字段");
        }
        if (Math.abs(Instant.now().toEpochMilli() - timestamp.longValue()) > MAX_SKEW_MILLIS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请求已过期，请重试");
        }

        cleanUpNonces();
        if (usedNonces.putIfAbsent(nonce, Instant.now().toEpochMilli()) != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请求已失效，请重试");
        }
        return password;
    }

    private void cleanUpNonces() {
        long cutoff = Instant.now().toEpochMilli() - NONCE_TTL_MILLIS;
        usedNonces.values().removeIf(createdAt -> createdAt < cutoff);
    }
}
