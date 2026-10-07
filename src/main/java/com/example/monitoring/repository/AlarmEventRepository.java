package com.example.monitoring.repository;

import com.example.monitoring.domain.AlarmEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AlarmEventRepository extends JpaRepository<AlarmEvent, Long> {

    List<AlarmEvent> findAllByOrderByIdDesc();

    List<AlarmEvent> findByHandledFalseOrderByIdDesc();

    long countByHandledFalse();
}
