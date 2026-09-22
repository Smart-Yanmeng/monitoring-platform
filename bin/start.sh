#!/usr/bin/env bash
# 以 setsid 方式启动后端与前端，脱离当前会话常驻运行
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME=/opt/dev/jdk/jdk-27
export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p "$ROOT/logs"

# 后端 (Spring Boot, 端口 8080)
setsid bash -c "cd '$ROOT' && mvn -q spring-boot:run > '$ROOT/logs/backend.log' 2>&1" < /dev/null &

# 前端 (Vite dev, 端口 5173)
setsid bash -c "cd '$ROOT/frontend' && npm run dev > '$ROOT/logs/frontend.log' 2>&1" < /dev/null &

echo "已启动：后端 http://localhost:8080  前端 http://localhost:5173"
echo "日志：logs/backend.log  logs/frontend.log"
