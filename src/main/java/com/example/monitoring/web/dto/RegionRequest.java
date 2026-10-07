package com.example.monitoring.web.dto;

public record RegionRequest(String name, Long parentId, int sortOrder, String description) {
}
