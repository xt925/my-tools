import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 前端开发服务器通过代理把 /api 和 /media 转发到后端（3001）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/media': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      }
    }
  }
})
