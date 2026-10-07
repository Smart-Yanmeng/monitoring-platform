package com.example.monitoring.web;

import com.example.monitoring.service.MessageService;
import com.example.monitoring.web.dto.MessageDto;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

    private final MessageService messageService;

    public MessageController(MessageService messageService) {
        this.messageService = messageService;
    }

    private String currentUser() {
        return SecurityContextHolder.getContext().getAuthentication().getName();
    }

    @GetMapping
    public List<MessageDto> list() {
        return messageService.list(currentUser());
    }

    @GetMapping("/unread-count")
    public Map<String, Long> unreadCount() {
        return Map.of("count", messageService.unreadCount(currentUser()));
    }

    @PutMapping("/{id}/read")
    public void read(@PathVariable Long id) {
        messageService.markRead(id, currentUser());
    }

    @PutMapping("/read-all")
    public void readAll() {
        messageService.markAllRead(currentUser());
    }
}
