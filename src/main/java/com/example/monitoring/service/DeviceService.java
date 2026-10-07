package com.example.monitoring.service;

import com.example.monitoring.domain.Device;
import com.example.monitoring.domain.Region;
import com.example.monitoring.repository.DeviceRepository;
import com.example.monitoring.repository.RegionRepository;
import com.example.monitoring.web.dto.DeviceDto;
import com.example.monitoring.web.dto.DeviceRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
public class DeviceService {

    private final DeviceRepository deviceRepository;
    private final RegionRepository regionRepository;

    public DeviceService(DeviceRepository deviceRepository, RegionRepository regionRepository) {
        this.deviceRepository = deviceRepository;
        this.regionRepository = regionRepository;
    }

    public List<DeviceDto> list(Long regionId, String type) {
        List<Device> all = deviceRepository.findAllByOrderByIdAsc();
        if (regionId != null) {
            all = all.stream().filter(d -> regionId.equals(d.getRegionId())).toList();
        }
        if (type != null && !type.isBlank()) {
            all = all.stream()
                    .filter(d -> d.getType().name().equalsIgnoreCase(type.trim()))
                    .toList();
        }
        return all.stream().map(this::toDto).toList();
    }

    public DeviceDto create(DeviceRequest req) {
        validate(req);
        Device d = new Device();
        apply(d, req);
        return toDto(deviceRepository.save(d));
    }

    public DeviceDto update(Long id, DeviceRequest req) {
        Device d = deviceRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "设备不存在"));
        validate(req);
        apply(d, req);
        return toDto(deviceRepository.save(d));
    }

    public void delete(Long id) {
        if (!deviceRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "设备不存在");
        }
        deviceRepository.deleteById(id);
    }

    public long countByRegion(Long regionId) {
        return deviceRepository.countByRegionId(regionId);
    }

    private void validate(DeviceRequest req) {
        if (req.name() == null || req.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "名称不能为空");
        }
        if (req.type() == null || req.type().isBlank()
                || !safeValueOf(Device.Type.class, req.type())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知类型: " + req.type());
        }
        if (req.status() != null && !req.status().isBlank()
                && !safeValueOf(Device.Status.class, req.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知状态: " + req.status());
        }
        if (req.regionId() != null && !regionRepository.existsById(req.regionId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "所属地区不存在");
        }
    }

    private void apply(Device d, DeviceRequest req) {
        d.setName(req.name().trim());
        d.setType(Device.Type.valueOf(req.type().toUpperCase()));
        d.setRegionId(req.regionId());
        d.setAddress(req.address());
        d.setStatus(req.status() == null || req.status().isBlank()
                ? Device.Status.UNKNOWN
                : Device.Status.valueOf(req.status().toUpperCase()));
        d.setNote(req.note());
    }

    private DeviceDto toDto(Device d) {
        String regionName = null;
        if (d.getRegionId() != null) {
            regionName = regionRepository.findById(d.getRegionId())
                    .map(Region::getName).orElse(null);
        }
        return new DeviceDto(
                d.getId(),
                d.getName(),
                d.getType().name(),
                d.getRegionId(),
                regionName,
                d.getAddress(),
                d.getStatus().name(),
                d.getNote());
    }

    private boolean safeValueOf(Class<? extends Enum<?>> enumClass, String value) {
        try {
            Enum.valueOf((Class) enumClass, value.toUpperCase());
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
