import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发服务器代理到后端 Spring Boot (8080)，保留路径前缀避免歧义
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/actuator': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
