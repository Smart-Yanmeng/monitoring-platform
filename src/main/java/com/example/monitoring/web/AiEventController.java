package com.example.monitoring.web;

import com.example.monitoring.service.AlarmService;
import com.example.monitoring.service.AiStatusStore;
import com.example.monitoring.web.dto.AiEventRequest;
import com.example.monitoring.web.dto.AiHeartbeatRequest;
import com.example.monitoring.web.dto.AiStatusDto;
import com.example.monitoring.web.dto.AlarmEventDto;
import com.example.monitoring.web.dto.AlarmRaiseRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/ai")
public class AiEventController {

    private final AlarmService alarmService;
    private final AiStatusStore statusStore;
    private final String apiKey;

    public AiEventController(AlarmService alarmService,
                             AiStatusStore statusStore,
                             @Value("${app.ai.api-key}") String apiKey) {
        this.alarmService = alarmService;
        this.statusStore = statusStore;
        this.apiKey = apiKey;
    }

    /** AI / 边缘盒子统一事件入口：校验 X-Api-Key 后转成内部报警 */
    @PostMapping("/events")
    public AlarmEventDto events(@RequestHeader(value = "X-Api-Key", required = false) String key,
                                @RequestBody AiEventRequest req) {
        if (key == null || !key.equals(apiKey)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid api key");
        }
        AlarmRaiseRequest raise = new AlarmRaiseRequest(
                req.deviceId(),
                req.regionId(),
                req.reason(),
                req.level() == null ? "WARNING" : req.level());
        return alarmService.raise(raise);
    }

    /** AI 服务心跳：上报当前启用模型与各摄像头状态 */
    @PostMapping("/heartbeat")
    public void heartbeat(@RequestHeader(value = "X-Api-Key", required = false) String key,
                          @RequestBody AiHeartbeatRequest req) {
        if (key == null || !key.equals(apiKey)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid api key");
        }
        statusStore.mark(req.activeModel(), req.cameras());
    }

    /** 前端 AI 服务状态页读取 */
    @GetMapping("/status")
    public AiStatusDto status() {
        return statusStore.snapshot();
    }
}
