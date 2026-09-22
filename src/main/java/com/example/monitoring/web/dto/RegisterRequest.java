package com.example.monitoring.web.dto;

/**
 * @param password 经公钥加密后的密码密文（Base64）
 * @param keyId    加密时使用的公钥标识
 */
public record RegisterRequest(String username, String password, String keyId) {
}
