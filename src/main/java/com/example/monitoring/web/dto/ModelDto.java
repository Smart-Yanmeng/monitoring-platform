package com.example.monitoring.web.dto;

public record ModelDto(
        Long id,
        String name,
        String filePath,
        String type,
        String description,
        boolean active,
        String createdAt) {
}
