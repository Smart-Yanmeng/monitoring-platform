package com.example.monitoring.service;

import com.example.monitoring.web.dto.AiStatusDto;
import com.example.monitoring.web.dto.CameraStatusDto;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/** 内存中保存 AI 服务最近一次心跳状态（无需持久化） */
@Component
public class AiStatusStore {

    private volatile long lastHeartbeat = 0;
    private volatile String activeModelPath;
    private final ConcurrentHashMap<Long, String> cameraStatus = new ConcurrentHashMap<>();

    public void mark(String activeModel, List<CameraStatusDto> cameras) {
        this.lastHeartbeat = System.currentTimeMillis();
        this.activeModelPath = activeModel;
        cameraStatus.clear();
        if (cameras != null) {
            for (CameraStatusDto c : cameras) {
                if (c.id() != null) cameraStatus.put(c.id(), c.status());
            }
        }
    }

    public AiStatusDto snapshot() {
        boolean online = System.currentTimeMillis() - lastHeartbeat < 60_000;
        List<CameraStatusDto> list = new ArrayList<>();
        cameraStatus.forEach((k, v) -> list.add(new CameraStatusDto(k, v)));
        return new AiStatusDto(lastHeartbeat, activeModelPath, online, list);
    }
}
