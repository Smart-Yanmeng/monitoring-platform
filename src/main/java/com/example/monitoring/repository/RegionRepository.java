package com.example.monitoring.repository;

import com.example.monitoring.domain.Region;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RegionRepository extends JpaRepository<Region, Long> {

    List<Region> findByParentId(Long parentId);

    List<Region> findByParentIdIsNullOrderByIdAsc();

    List<Region> findAllByOrderByIdAsc();
}
