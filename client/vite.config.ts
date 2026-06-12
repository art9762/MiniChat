import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // WebSocket endpoint for the agent runner — listed before the generic
      // /api entry so it wins the match and upgrades the connection.
      '/api/agent/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
      '/api': 'http://localhost:3001',
    },
  },
})
