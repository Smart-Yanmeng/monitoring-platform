package com.example.monitoring.security;

import org.springframework.stereotype.Service;
import javax.crypto.Cipher;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.UUID;

/**
 * RSA 密钥服务：应用启动时生成密钥对，对外暴露公钥（PEM），私钥用于解密前端密文。
 */
@Service
public class RsaKeyService {

    private final KeyPair keyPair;
    private final String keyId;

    public RsaKeyService() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            this.keyPair = generator.generateKeyPair();
            this.keyId = UUID.randomUUID().toString();
        } catch (Exception e) {
            throw new IllegalStateException("RSA 密钥初始化失败", e);
        }
    }

    public String getKeyId() {
        return keyId;
    }

    /** 公钥 PEM（X.509 SubjectPublicKeyInfo），供前端 jsencrypt 直接使用 */
    public String getPublicKeyPem() {
        String base64 = Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());
        return "-----BEGIN PUBLIC KEY-----\n"
                + base64.replaceAll("(.{64})", "$1\n")
                + "\n-----END PUBLIC KEY-----";
    }

    /** 解密前端 RSA 密文（Base64），返回明文 JSON */
    public String decrypt(String base64Cipher) {
        try {
            Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding");
            cipher.init(Cipher.DECRYPT_MODE, keyPair.getPrivate());
            byte[] plain = cipher.doFinal(Base64.getDecoder().decode(base64Cipher));
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalArgumentException("密文解密失败", e);
        }
    }
}
