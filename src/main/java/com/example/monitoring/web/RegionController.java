package com.example.monitoring.web;

import com.example.monitoring.service.RegionService;
import com.example.monitoring.web.dto.RegionDto;
import com.example.monitoring.web.dto.RegionRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/regions")
public class RegionController {

    private final RegionService regionService;

    public RegionController(RegionService regionService) {
        this.regionService = regionService;
    }

    @GetMapping
    public List<RegionDto> list() {
        return regionService.list();
    }

    @PostMapping
    public ResponseEntity<RegionDto> create(@RequestBody RegionRequest req) {
        return ResponseEntity.ok(regionService.create(req));
    }

    @PutMapping("/{id}")
    public RegionDto update(@PathVariable Long id, @RequestBody RegionRequest req) {
        return regionService.update(id, req);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        regionService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
