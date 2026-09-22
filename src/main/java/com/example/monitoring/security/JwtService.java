package com.example.monitoring.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

@Service
public class JwtService {

    private final JwtEncoder encoder;
    private final Duration expiration;

    public JwtService(JwtEncoder encoder, @Value("${app.security.jwt.expiration-minutes:120}") long minutes) {
        this.encoder = encoder;
        this.expiration = Duration.ofMinutes(minutes);
    }

    public String generate(Authentication authentication) {
        Instant now = Instant.now();
        // 仅签发业务角色，过滤 Spring Security 内部 authority（如 FACTOR_PASSWORD）
        List<String> authorities = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(a -> a.startsWith("ROLE_"))
                .toList();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("monitoring-platform")
                .subject(authentication.getName())
                .issuedAt(now)
                .expiresAt(now.plus(expiration))
                .claim("authorities", authorities)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }
}
