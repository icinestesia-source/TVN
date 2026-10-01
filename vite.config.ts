import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { channelMiddleware } from './server/youtube-channel.ts'

/** The Add Channel lookup, served by the dev and preview servers as the Netlify Function serves it in production. */
function channelApi(): Plugin {
  return {
    name: 'tvn-channel-api',
    configureServer(server) {
      server.middlewares.use('/api/channel', channelMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/channel', channelMiddleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), channelApi()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
