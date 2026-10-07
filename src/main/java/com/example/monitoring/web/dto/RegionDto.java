package com.example.monitoring.web.dto;

public record RegionDto(Long id, String name, Long parentId, int sortOrder, String description) {
}
