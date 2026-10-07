package com.example.monitoring.service;

import com.example.monitoring.domain.AiModel;
import com.example.monitoring.repository.AiModelRepository;
import com.example.monitoring.web.dto.ModelDto;
import com.example.monitoring.web.dto.ModelRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;

@Service
public class ModelService {

    private final AiModelRepository repository;

    public ModelService(AiModelRepository repository) {
        this.repository = repository;
    }

    public List<ModelDto> list() {
        return repository.findAllByOrderByIdDesc().stream().map(this::toDto).toList();
    }

    public Optional<ModelDto> getActive() {
        return repository.findByActiveTrue().map(this::toDto);
    }

    public ModelDto create(ModelRequest req) {
        if (req.name() == null || req.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "模型名称不能为空");
        }
        if (req.filePath() == null || req.filePath().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "模型文件路径不能为空");
        }
        AiModel m = new AiModel();
        m.setName(req.name().trim());
        m.setFilePath(req.filePath().trim());
        m.setType(req.type());
        m.setDescription(req.description());
        m.setActive(false);
        m.setCreatedAt(LocalDateTime.now());
        return toDto(repository.save(m));
    }

    /** 设置为启用模型：其余全部置为未启用，全局仅一个启用 */
    @Transactional
    public ModelDto setActive(Long id) {
        AiModel target = repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "模型不存在"));
        repository.deactivateAll();
        target.setActive(true);
        return toDto(repository.save(target));
    }

    public void delete(Long id) {
        if (!repository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "模型不存在");
        }
        repository.deleteById(id);
    }

    private ModelDto toDto(AiModel m) {
        return new ModelDto(
                m.getId(),
                m.getName(),
                m.getFilePath(),
                m.getType(),
                m.getDescription(),
                m.isActive(),
                m.getCreatedAt() == null ? null
                        : m.getCreatedAt().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
    }
}
