package com.example.monitoring.web.dto;

public record AiEventRequest(
        Long deviceId,
        Long regionId,
        String reason,
        String level,
        Double confidence) {
}
