package com.example.monitoring.security;

import com.example.monitoring.domain.AiModel;
import com.example.monitoring.domain.Region;
import com.example.monitoring.domain.Role;
import com.example.monitoring.domain.User;
import com.example.monitoring.repository.AiModelRepository;
import com.example.monitoring.repository.RegionRepository;
import com.example.monitoring.repository.RoleRepository;
import com.example.monitoring.repository.UserRepository;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import java.io.File;
import java.util.Set;

@Component
public class DataInitializer implements ApplicationRunner {

    private final RoleRepository roleRepository;
    private final UserRepository userRepository;
    private final RegionRepository regionRepository;
    private final AiModelRepository aiModelRepository;
    private final PasswordEncoder passwordEncoder;

    public DataInitializer(RoleRepository roleRepository, UserRepository userRepository,
                           RegionRepository regionRepository, AiModelRepository aiModelRepository,
                           PasswordEncoder passwordEncoder) {
        this.roleRepository = roleRepository;
        this.userRepository = userRepository;
        this.regionRepository = regionRepository;
        this.aiModelRepository = aiModelRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        Role adminRole = roleRepository.findByName("ROLE_ADMIN")
                .orElseGet(() -> roleRepository.save(new Role("ROLE_ADMIN", "管理员")));
        Role userRole = roleRepository.findByName("ROLE_USER")
                .orElseGet(() -> roleRepository.save(new Role("ROLE_USER", "普通用户")));
        if (userRepository.findByUsername("admin").isEmpty()) {
            User admin = new User();
            admin.setUsername("admin");
            admin.setPassword(passwordEncoder.encode("admin123"));
            admin.setEnabled(true);
            admin.setRoles(Set.of(adminRole, userRole));
            userRepository.save(admin);
        }
        if (regionRepository.count() == 0) {
            seedRegions();
        }
        if (aiModelRepository.count() == 0) {
            seedModels();
        }
    }

    /** 预置多级地区：校区 → 楼栋 → 楼层 → 具体地点 */
    private void seedRegions() {
        // 本部校区
        long campus1 = addRegion("本部校区", null, 1, "学校主校区");
        long teach = addRegion("第一教学楼", campus1, 1, "教学办公楼");
        long teach1f = addRegion("1层", teach, 1, "");
        addRegion("101教室", teach1f, 1, "多媒体教室");
        addRegion("走廊", teach1f, 2, "");
        long teach2f = addRegion("2层", teach, 2, "");
        addRegion("201教室", teach2f, 1, "实验室");
        long dorm = addRegion("第五社区", campus1, 2, "学生宿舍区");
        long dorm3 = addRegion("3号楼", dorm, 1, "宿舍楼");
        addRegion("1层", dorm3, 1, "");
        addRegion("2层", dorm3, 2, "");
        // 南校区
        long campus2 = addRegion("南校区", null, 2, "分校区");
        long lab = addRegion("实验楼", campus2, 1, "");
        addRegion("1层", lab, 1, "");
        addRegion("大厅", lab, 1, "入口大厅");
    }

    private long addRegion(String name, Long parentId, int order, String desc) {
        Region r = new Region();
        r.setName(name);
        r.setParentId(parentId);
        r.setSortOrder(order);
        r.setDescription(desc);
        return regionRepository.save(r).getId();
    }

    /** 预置之前训练的打架检测模型（yolo_small 启用，yolo_nano 备用）。
     *  纯 Java 链路加载 ONNX 权重，故此处登记 .onnx 路径（由 scripts/export_onnx.py 导出） */
    private void seedModels() {
        String base = new File("ai-service/models").getAbsolutePath() + "/";
        AiModel small = new AiModel();
        small.setName("打架检测-YOLO小模型");
        small.setFilePath(base + "fight_yolo_small.onnx");
        small.setType("fight");
        small.setDescription("musawer_fight 数据集训练，类别 violence/non_violence，精度较高（ONNX）");
        small.setActive(true);
        aiModelRepository.save(small);

        AiModel nano = new AiModel();
        nano.setName("打架检测-YOLO纳米模型");
        nano.setFilePath(base + "fight_yolo_nano.onnx");
        nano.setType("fight");
        nano.setDescription("同数据集训练，体积更小、推理更快，适合边缘设备（ONNX）");
        nano.setActive(false);
        aiModelRepository.save(nano);
    }
}
