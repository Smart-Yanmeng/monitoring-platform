package com.example.monitoring.web.dto;

import java.util.List;

public record LoginResponse(String token, String username, List<String> authorities) {
}
