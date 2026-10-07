package com.example.monitoring.web.dto;

public record AlarmRaiseRequest(Long deviceId, Long regionId, String reason, String level) {
}
