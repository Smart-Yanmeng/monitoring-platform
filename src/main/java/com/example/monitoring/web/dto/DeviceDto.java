package com.example.monitoring.web.dto;

public record DeviceDto(
        Long id,
        String name,
        String type,
        Long regionId,
        String regionName,
        String address,
        String status,
        String note) {
}
