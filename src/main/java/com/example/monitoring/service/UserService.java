package com.example.monitoring.service;

import com.example.monitoring.domain.Role;
import com.example.monitoring.domain.User;
import com.example.monitoring.repository.RoleRepository;
import com.example.monitoring.repository.UserRepository;
import com.example.monitoring.web.dto.RegisterRequest;
import com.example.monitoring.web.dto.UserCreateRequest;
import com.example.monitoring.web.dto.UserDto;
import com.example.monitoring.web.dto.UserUpdateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository, RoleRepository roleRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public List<UserDto> list() {
        return userRepository.findAll().stream().map(this::toDto).collect(Collectors.toList());
    }

    public UserDto create(UserCreateRequest req) {
        if (userRepository.existsByUsername(req.username())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "用户名已存在");
        }
        User user = new User();
        user.setUsername(req.username());
        user.setPassword(passwordEncoder.encode(req.password()));
        user.setEnabled(true);
        user.setRoles(resolveRoles(req.roles()));
        return toDto(userRepository.save(user));
    }

    public UserDto update(Long id, UserUpdateRequest req) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在"));
        if (req.password() != null && !req.password().isBlank()) {
            user.setPassword(passwordEncoder.encode(req.password()));
        }
        if (req.enabled() != null) {
            user.setEnabled(req.enabled());
        }
        if (req.roles() != null) {
            user.setRoles(resolveRoles(req.roles()));
        }
        return toDto(userRepository.save(user));
    }

    public void delete(Long id) {
        if (!userRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在");
        }
        userRepository.deleteById(id);
    }

    /**
     * 开放注册：强制仅赋予 ROLE_USER，避免通过注册接口提权为 ADMIN。
     */
    public UserDto register(RegisterRequest req) {
        if (req.username() == null || req.username().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "用户名不能为空");
        }
        if (req.password() == null || req.password().length() < 6) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密码至少 6 位");
        }
        if (userRepository.existsByUsername(req.username())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "用户名已存在");
        }
        Role userRole = roleRepository.findByName("ROLE_USER")
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "默认角色 ROLE_USER 不存在"));
        User user = new User();
        user.setUsername(req.username().trim());
        user.setPassword(passwordEncoder.encode(req.password()));
        user.setEnabled(true);
        user.setRoles(Set.of(userRole));
        return toDto(userRepository.save(user));
    }

    private Set<Role> resolveRoles(Set<String> names) {
        if (names == null || names.isEmpty()) {
            return Set.of();
        }
        return names.stream()
                .map(name -> roleRepository.findByName(name)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知角色: " + name)))
                .collect(Collectors.toSet());
    }

    private UserDto toDto(User user) {
        Set<String> roleNames = user.getRoles().stream().map(Role::getName).collect(Collectors.toSet());
        return new UserDto(user.getId(), user.getUsername(), user.isEnabled(), roleNames);
    }
}
