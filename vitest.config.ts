// MIT License - Copyright (c) fintonlabs.com
// Frontend/unit tests (reducer, flow model, engine helpers). Server + engine
// integration tests stay on `node --test` (tests/*.test.mjs, run by `npm test`).
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
