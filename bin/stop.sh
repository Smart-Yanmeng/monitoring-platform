#!/usr/bin/env bash
# 停止常驻的后端与前端进程
pkill -f 'spring-boot:run' || true
pkill -f 'vite' || true
echo "已发送停止信号"
