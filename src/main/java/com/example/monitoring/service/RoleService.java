package com.example.monitoring.service;

import com.example.monitoring.domain.Role;
import com.example.monitoring.repository.RoleRepository;
import com.example.monitoring.web.dto.RoleCreateRequest;
import com.example.monitoring.web.dto.RoleDto;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class RoleService {

    private final RoleRepository roleRepository;

    public RoleService(RoleRepository roleRepository) {
        this.roleRepository = roleRepository;
    }

    public List<RoleDto> list() {
        return roleRepository.findAll().stream()
                .map(r -> new RoleDto(r.getId(), r.getName(), r.getDescription()))
                .collect(Collectors.toList());
    }

    public RoleDto create(RoleCreateRequest req) {
        if (roleRepository.findByName(req.name()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "角色已存在");
        }
        Role saved = roleRepository.save(new Role(req.name(), req.description()));
        return new RoleDto(saved.getId(), saved.getName(), saved.getDescription());
    }

    public void delete(Long id) {
        if (!roleRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "角色不存在");
        }
        roleRepository.deleteById(id);
    }
}
