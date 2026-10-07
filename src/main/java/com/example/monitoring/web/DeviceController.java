package com.example.monitoring.web;

import com.example.monitoring.service.DeviceService;
import com.example.monitoring.web.dto.DeviceDto;
import com.example.monitoring.web.dto.DeviceRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/devices")
public class DeviceController {

    private final DeviceService deviceService;

    public DeviceController(DeviceService deviceService) {
        this.deviceService = deviceService;
    }

    @GetMapping
    public List<DeviceDto> list(@RequestParam(required = false) Long regionId,
                               @RequestParam(required = false) String type) {
        return deviceService.list(regionId, type);
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<DeviceDto> create(@RequestBody DeviceRequest req) {
        return ResponseEntity.ok(deviceService.create(req));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public DeviceDto update(@PathVariable Long id, @RequestBody DeviceRequest req) {
        return deviceService.update(id, req);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        deviceService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
