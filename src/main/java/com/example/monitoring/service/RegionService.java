package com.example.monitoring.service;

import com.example.monitoring.domain.Region;
import com.example.monitoring.repository.RegionRepository;
import com.example.monitoring.web.dto.RegionDto;
import com.example.monitoring.web.dto.RegionRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;

@Service
public class RegionService {

    private final RegionRepository regionRepository;

    public RegionService(RegionRepository regionRepository) {
        this.regionRepository = regionRepository;
    }

    public List<RegionDto> list() {
        return regionRepository.findAllByOrderByIdAsc().stream().map(this::toDto).toList();
    }

    public RegionDto create(RegionRequest req) {
        if (req.name() == null || req.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "名称不能为空");
        }
        validateParent(req.parentId(), null);
        Region region = new Region();
        region.setName(req.name().trim());
        region.setParentId(req.parentId());
        region.setSortOrder(req.sortOrder());
        region.setDescription(req.description());
        return toDto(regionRepository.save(region));
    }

    public RegionDto update(Long id, RegionRequest req) {
        Region region = regionRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "地区不存在"));
        if (req.name() == null || req.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "名称不能为空");
        }
        validateParent(req.parentId(), id);
        region.setName(req.name().trim());
        region.setParentId(req.parentId());
        region.setSortOrder(req.sortOrder());
        region.setDescription(req.description());
        return toDto(regionRepository.save(region));
    }

    @Transactional
    public void delete(Long id) {
        if (!regionRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "地区不存在");
        }
        deleteSubtree(id);
    }

    private void deleteSubtree(Long id) {
        for (Region child : regionRepository.findByParentId(id)) {
            deleteSubtree(child.getId());
        }
        regionRepository.deleteById(id);
    }

    /** 校验父级：不能为自身或自身的后代，避免成环 */
    private void validateParent(Long parentId, Long selfId) {
        if (parentId == null) {
            return;
        }
        if (selfId != null && parentId.equals(selfId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "父级不能是自身");
        }
        if (selfId != null) {
            List<Long> descendants = new ArrayList<>();
            collectDescendants(selfId, descendants);
            if (descendants.contains(parentId)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "父级不能是自身的子级");
            }
        }
    }

    private void collectDescendants(Long rootId, List<Long> out) {
        for (Region child : regionRepository.findByParentId(rootId)) {
            out.add(child.getId());
            collectDescendants(child.getId(), out);
        }
    }

    private RegionDto toDto(Region r) {
        return new RegionDto(r.getId(), r.getName(), r.getParentId(), r.getSortOrder(), r.getDescription());
    }
}
