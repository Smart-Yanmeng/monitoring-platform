package com.example.monitoring.web.dto;

import java.util.Set;

public record UserDto(Long id, String username, boolean enabled, Set<String> roles) {
}
