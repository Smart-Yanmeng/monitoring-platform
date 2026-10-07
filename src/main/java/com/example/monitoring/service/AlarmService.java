package com.example.monitoring.service;

import com.example.monitoring.domain.AlarmEvent;
import com.example.monitoring.domain.Device;
import com.example.monitoring.domain.Region;
import com.example.monitoring.repository.AlarmEventRepository;
import com.example.monitoring.repository.DeviceRepository;
import com.example.monitoring.repository.RegionRepository;
import com.example.monitoring.service.MessageService;
import com.example.monitoring.web.dto.AlarmEventDto;
import com.example.monitoring.web.dto.AlarmHandleRequest;
import com.example.monitoring.web.dto.AlarmRaiseRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class AlarmService {

    private final AlarmEventRepository alarmEventRepository;
    private final DeviceRepository deviceRepository;
    private final RegionRepository regionRepository;
    private final MessageService messageService;

    public AlarmService(AlarmEventRepository alarmEventRepository,
                        DeviceRepository deviceRepository,
                        RegionRepository regionRepository,
                        MessageService messageService) {
        this.alarmEventRepository = alarmEventRepository;
        this.deviceRepository = deviceRepository;
        this.regionRepository = regionRepository;
        this.messageService = messageService;
    }

    public List<AlarmEventDto> list(Long regionId, Boolean handled, Long deviceId,
                                    String startTime, String endTime) {
        List<AlarmEvent> all = alarmEventRepository.findAllByOrderByIdDesc();
        if (deviceId != null) {
            all = all.stream().filter(e -> deviceId.equals(e.getDeviceId())).collect(Collectors.toList());
        }
        if (handled != null) {
            boolean target = handled;
            all = all.stream().filter(e -> e.isHandled() == target).collect(Collectors.toList());
        }
        if (regionId != null) {
            Set<Long> scope = expandRegion(regionId);
            all = all.stream()
                    .filter(e -> e.getRegionId() != null && scope.contains(e.getRegionId()))
                    .collect(Collectors.toList());
        }
        if (startTime != null && !startTime.isBlank()) {
            LocalDateTime s = parseTime(startTime, true);
            if (s != null) {
                all = all.stream().filter(e -> !e.getTime().isBefore(s)).collect(Collectors.toList());
            }
        }
        if (endTime != null && !endTime.isBlank()) {
            LocalDateTime end = parseTime(endTime, false);
            if (end != null) {
                all = all.stream().filter(e -> !e.getTime().isAfter(end)).collect(Collectors.toList());
            }
        }
        return all.stream().map(this::toDto).collect(Collectors.toList());
    }

    public List<AlarmEventDto> unhandled() {
        return alarmEventRepository.findByHandledFalseOrderByIdDesc().stream()
                .map(this::toDto).collect(Collectors.toList());
    }

    public long unhandledCount() {
        return alarmEventRepository.countByHandledFalse();
    }

    public AlarmEventDto raise(AlarmRaiseRequest req) {
        Long regionId = req.regionId();
        if (req.deviceId() != null) {
            Device d = deviceRepository.findById(req.deviceId())
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "设备不存在"));
            regionId = d.getRegionId();
        }
        if (regionId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "报警需关联设备（自动取地区）或指定地区");
        }
        if (req.reason() == null || req.reason().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "报警原因不能为空");
        }
        AlarmEvent e = new AlarmEvent();
        e.setDeviceId(req.deviceId());
        e.setRegionId(regionId);
        e.setReason(req.reason().trim());
        e.setLevel(parseLevel(req.level()));
        e.setTime(LocalDateTime.now());
        e.setHandled(false);
        AlarmEvent saved = alarmEventRepository.save(e);

        String deviceName = e.getDeviceId() == null ? null
                : deviceRepository.findById(e.getDeviceId()).map(Device::getName).orElse(null);
        String regionName = e.getRegionId() == null ? null
                : regionRepository.findById(e.getRegionId()).map(Region::getName).orElse(null);
        messageService.notifyAlarm(saved.getId(), deviceName, regionName, e.getReason(), e.getLevel().name());

        return toDto(saved);
    }

    public AlarmEventDto handle(Long id, AlarmHandleRequest req) {
        AlarmEvent e = alarmEventRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "报警不存在"));
        e.setHandled(true);
        e.setHandledTime(LocalDateTime.now());
        e.setNote(req.note());
        return toDto(alarmEventRepository.save(e));
    }

    public void delete(Long id) {
        if (!alarmEventRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "报警不存在");
        }
        alarmEventRepository.deleteById(id);
    }

    private AlarmEvent.Level parseLevel(String l) {
        if (l == null || l.isBlank()) return AlarmEvent.Level.WARNING;
        try {
            return AlarmEvent.Level.valueOf(l.toUpperCase());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知等级: " + l);
        }
    }

    private LocalDateTime parseTime(String s, boolean startOfDay) {
        s = s.trim();
        DateTimeFormatter f1 = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        DateTimeFormatter f2 = DateTimeFormatter.ofPattern("yyyy-MM-dd");
        try {
            if (s.length() <= 10) {
                LocalDate d = LocalDate.parse(s, f2);
                return startOfDay ? d.atStartOfDay() : d.atTime(23, 59, 59);
            }
            return LocalDateTime.parse(s, f1);
        } catch (Exception ex) {
            return null;
        }
    }

    /** 展开地区及其全部下级，便于按校区/楼栋查看范围内报警 */
    private Set<Long> expandRegion(Long rootId) {
        Set<Long> scope = new HashSet<>();
        scope.add(rootId);
        Map<Long, List<Region>> children = regionRepository.findAll().stream()
                .filter(r -> r.getParentId() != null)
                .collect(Collectors.groupingBy(Region::getParentId));
        Deque<Long> stack = new ArrayDeque<>();
        stack.push(rootId);
        while (!stack.isEmpty()) {
            Long cur = stack.pop();
            for (Region c : children.getOrDefault(cur, List.of())) {
                if (scope.add(c.getId())) {
                    stack.push(c.getId());
                }
            }
        }
        return scope;
    }

    private AlarmEventDto toDto(AlarmEvent e) {
        String deviceName = e.getDeviceId() == null ? null
                : deviceRepository.findById(e.getDeviceId()).map(Device::getName).orElse(null);
        String regionName = e.getRegionId() == null ? null
                : regionRepository.findById(e.getRegionId()).map(Region::getName).orElse(null);
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        return new AlarmEventDto(
                e.getId(),
                e.getDeviceId(),
                deviceName,
                e.getRegionId(),
                regionName,
                e.getReason(),
                e.getLevel().name(),
                e.getTime().format(fmt),
                e.isHandled(),
                e.getHandledTime() == null ? null : e.getHandledTime().format(fmt),
                e.getNote());
    }
}
