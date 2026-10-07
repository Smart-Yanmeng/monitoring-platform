package com.example.monitoring.web.dto;

public record AlarmEventDto(
        Long id,
        Long deviceId,
        String deviceName,
        Long regionId,
        String regionName,
        String reason,
        String level,
        String time,
        boolean handled,
        String handledTime,
        String note) {
}
