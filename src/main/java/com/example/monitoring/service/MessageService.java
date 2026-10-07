package com.example.monitoring.service;

import com.example.monitoring.domain.Message;
import com.example.monitoring.domain.User;
import com.example.monitoring.repository.MessageRepository;
import com.example.monitoring.repository.UserRepository;
import com.example.monitoring.web.dto.MessageDto;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class MessageService {

    private final MessageRepository messageRepository;
    private final UserRepository userRepository;

    public MessageService(MessageRepository messageRepository, UserRepository userRepository) {
        this.messageRepository = messageRepository;
        this.userRepository = userRepository;
    }

    /** 报警产生时，给所有用户各发一条站内信（按接收人存储，已读状态相互独立） */
    public void notifyAlarm(Long alarmId, String deviceName, String regionName, String reason, String level) {
        String title = "新报警通知";
        String content = "报警点：" + (deviceName == null ? "未关联" : deviceName)
                + "\n地区：" + (regionName == null ? "未指定" : regionName)
                + "\n原因：" + reason
                + "\n等级：" + level;
        for (User u : userRepository.findAll()) {
            Message m = new Message();
            m.setUsername(u.getUsername());
            m.setTitle(title);
            m.setContent(content);
            m.setType("ALARM");
            m.setLink("/alarms");
            m.setRead(false);
            m.setCreatedAt(LocalDateTime.now());
            m.setAlarmId(alarmId);
            messageRepository.save(m);
        }
    }

    public List<MessageDto> list(String username) {
        return messageRepository.findByUser(username).stream().map(this::toDto).collect(Collectors.toList());
    }

    public long unreadCount(String username) {
        return messageRepository.countUnread(username);
    }

    public void markRead(Long id, String username) {
        messageRepository.findById(id).ifPresent(m -> {
            if (visible(m, username)) {
                m.setRead(true);
                messageRepository.save(m);
            }
        });
    }

    public void markAllRead(String username) {
        messageRepository.findByUser(username).forEach(m -> {
            m.setRead(true);
            messageRepository.save(m);
        });
    }

    private boolean visible(Message m, String username) {
        return m.getUsername() == null || m.getUsername().equals(username);
    }

    private MessageDto toDto(Message m) {
        return new MessageDto(
                m.getId(),
                m.getUsername(),
                m.getTitle(),
                m.getContent(),
                m.getType(),
                m.getLink(),
                m.isRead(),
                m.getCreatedAt() == null ? null
                        : m.getCreatedAt().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")),
                m.getAlarmId());
    }
}
