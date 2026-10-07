package com.example.monitoring.web.dto;

public record ModelRequest(
        String name,
        String filePath,
        String type,
        String description) {
}
