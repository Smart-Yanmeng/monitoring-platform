package com.example.monitoring.web.dto;

import java.util.List;

public record AiStatusDto(
        long lastHeartbeat,
        String activeModel,
        boolean online,
        List<CameraStatusDto> cameras) {
}
