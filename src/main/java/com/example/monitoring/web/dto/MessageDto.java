package com.example.monitoring.web.dto;

public record MessageDto(
        Long id,
        String username,
        String title,
        String content,
        String type,
        String link,
        boolean read,
        String createdAt,
        Long alarmId) {
}
