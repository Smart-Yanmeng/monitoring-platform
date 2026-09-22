package com.example.monitoring.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 解析 Authorization: Bearer <token> 并建立安全上下文。
 * 不作为 @Component，避免被自动注册为全局 Servlet Filter 而重复执行。
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtDecoder decoder;

    public JwtAuthenticationFilter(JwtDecoder decoder) {
        this.decoder = decoder;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);
            try {
                Jwt jwt = decoder.decode(token);
                String username = jwt.getSubject();
                List<String> authorities = jwt.getClaimAsStringList("authorities");
                if (username != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                    var granted = authorities == null
                            ? List.<SimpleGrantedAuthority>of()
                            : authorities.stream().map(SimpleGrantedAuthority::new).collect(Collectors.toList());
                    var auth = new UsernamePasswordAuthenticationToken(username, null, granted);
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (JwtException e) {
                // token 无效或过期：清空上下文，交由后续鉴权返回 401
                SecurityContextHolder.clearContext();
            }
        }
        chain.doFilter(request, response);
    }
}
