// MIT License - Copyright (c) fintonlabs.com
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 8451,
    allowedHosts: ['oracle.local'],
    proxy: {
      '/api': 'http://localhost:8452',
    },
  },
})
