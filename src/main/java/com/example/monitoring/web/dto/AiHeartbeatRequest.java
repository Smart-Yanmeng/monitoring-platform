package com.example.monitoring.web.dto;

import java.util.List;

public record AiHeartbeatRequest(
        String activeModel,
        List<CameraStatusDto> cameras) {
}
