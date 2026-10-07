package com.example.monitoring.repository;

import com.example.monitoring.domain.Message;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface MessageRepository extends JpaRepository<Message, Long> {

    /** 当前用户可见的站内信：指定给本人 或 全员广播（username 为 null） */
    @Query("SELECT m FROM Message m WHERE (m.username = :u OR m.username IS NULL) ORDER BY m.createdAt DESC")
    List<Message> findByUser(@Param("u") String username);

    /** 当前用户未读数量 */
    @Query("SELECT COUNT(m) FROM Message m WHERE (m.username = :u OR m.username IS NULL) AND m.read = false")
    long countUnread(@Param("u") String username);
}
