package com.example.monitoring.repository;

import com.example.monitoring.domain.AiModel;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface AiModelRepository extends JpaRepository<AiModel, Long> {

    Optional<AiModel> findByActiveTrue();

    List<AiModel> findAllByOrderByIdDesc();

    @Modifying
    @Query("UPDATE AiModel m SET m.active = false")
    void deactivateAll();
}
