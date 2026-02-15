import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/Huji-meet/',
  plugins: [react()],
  server: {
    headers: {
      'Permissions-Policy': 'microphone=(self)',
    },
  },
})
