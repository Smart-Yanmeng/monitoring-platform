package com.example.monitoring.web.dto;

import java.util.Set;

/**
 * @param password 经公钥加密后的密码密文（Base64）
 * @param keyId    加密时使用的公钥标识
 */
public record UserCreateRequest(String username, String password, Set<String> roles, String keyId) {
}
