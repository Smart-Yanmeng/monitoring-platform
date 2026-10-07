package com.example.monitoring.repository;

import com.example.monitoring.domain.Device;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DeviceRepository extends JpaRepository<Device, Long> {

    List<Device> findByRegionId(Long regionId);

    List<Device> findAllByOrderByIdAsc();

    long countByRegionId(Long regionId);
}
