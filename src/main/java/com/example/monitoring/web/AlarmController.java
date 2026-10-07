package com.example.monitoring.web;

import com.example.monitoring.service.AlarmService;
import com.example.monitoring.web.dto.AlarmEventDto;
import com.example.monitoring.web.dto.AlarmHandleRequest;
import com.example.monitoring.web.dto.AlarmRaiseRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
@RequestMapping("/api/alarms")
public class AlarmController {

    private final AlarmService alarmService;

    public AlarmController(AlarmService alarmService) {
        this.alarmService = alarmService;
    }

    @GetMapping
    public List<AlarmEventDto> list(@RequestParam(required = false) Long regionId,
                                   @RequestParam(required = false) Boolean handled,
                                   @RequestParam(required = false) Long deviceId,
                                   @RequestParam(required = false) String startTime,
                                   @RequestParam(required = false) String endTime) {
        return alarmService.list(regionId, handled, deviceId, startTime, endTime);
    }

    @GetMapping(value = "/export", produces = "text/csv;charset=utf-8")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) Long regionId,
                                        @RequestParam(required = false) Boolean handled,
                                        @RequestParam(required = false) Long deviceId,
                                        @RequestParam(required = false) String startTime,
                                        @RequestParam(required = false) String endTime) {
        List<AlarmEventDto> list = alarmService.list(regionId, handled, deviceId, startTime, endTime);
        StringBuilder sb = new StringBuilder();
        sb.append("﻿"); // UTF-8 BOM，Excel 中文不乱码
        sb.append("ID,时间,报警点ID,报警点,地区ID,地区,原因,等级,是否处理,处理时间,处理备注\n");
        for (AlarmEventDto e : list) {
            sb.append(e.id()).append(',')
              .append(csv(e.time())).append(',')
              .append(e.deviceId() == null ? "" : e.deviceId()).append(',')
              .append(csv(e.deviceName())).append(',')
              .append(e.regionId() == null ? "" : e.regionId()).append(',')
              .append(csv(e.regionName())).append(',')
              .append(csv(e.reason())).append(',')
              .append(csv(e.level())).append(',')
              .append(e.handled() ? "是" : "否").append(',')
              .append(csv(e.handledTime())).append(',')
              .append(csv(e.note())).append('\n');
        }
        byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=alarms.csv")
                .contentType(MediaType.parseMediaType("text/csv;charset=utf-8"))
                .body(bytes);
    }

    private String csv(String v) {
        if (v == null) return "";
        if (v.contains(",") || v.contains("\"") || v.contains("\n")) {
            return "\"" + v.replace("\"", "\"\"") + "\"";
        }
        return v;
    }

    @GetMapping("/unhandled")
    public List<AlarmEventDto> unhandled() {
        return alarmService.unhandled();
    }

    @PostMapping
    public ResponseEntity<AlarmEventDto> raise(@RequestBody AlarmRaiseRequest req) {
        return ResponseEntity.ok(alarmService.raise(req));
    }

    @PutMapping("/{id}/handle")
    public AlarmEventDto handle(@PathVariable Long id, @RequestBody AlarmHandleRequest req) {
        return alarmService.handle(id, req);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        alarmService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
