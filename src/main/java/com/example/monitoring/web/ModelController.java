package com.example.monitoring.web;

import com.example.monitoring.service.ModelService;
import com.example.monitoring.web.dto.ModelDto;
import com.example.monitoring.web.dto.ModelRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/models")
public class ModelController {

    private final ModelService modelService;

    public ModelController(ModelService modelService) {
        this.modelService = modelService;
    }

    @GetMapping
    public List<ModelDto> list() {
        return modelService.list();
    }

    @GetMapping("/active")
    public ResponseEntity<ModelDto> active() {
        return modelService.getActive()
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.noContent().build());
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ModelDto> create(@RequestBody ModelRequest req) {
        return ResponseEntity.ok(modelService.create(req));
    }

    @PutMapping("/{id}/activate")
    @PreAuthorize("hasRole('ADMIN')")
    public ModelDto activate(@PathVariable Long id) {
        return modelService.setActive(id);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        modelService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
