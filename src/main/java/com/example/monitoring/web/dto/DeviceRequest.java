package com.example.monitoring.web.dto;

public record DeviceRequest(
        String name,
        String type,
        Long regionId,
        String address,
        String status,
        String note) {
}
