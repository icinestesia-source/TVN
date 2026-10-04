import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { feedMiddleware } from './server/podcast-feed.ts'
import { channelMiddleware } from './server/youtube-channel.ts'

/** The Add Channel lookup, served by the dev and preview servers as the Netlify Function serves it in production. */
function channelApi(): Plugin {
  return {
    name: 'tvn-channel-api',
    configureServer(server) {
      server.middlewares.use('/api/channel', channelMiddleware)
      server.middlewares.use('/api/feed', feedMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/channel', channelMiddleware)
      server.middlewares.use('/api/feed', feedMiddleware)
    },
  }
}

/** The commit being built: Netlify names it in COMMIT_REF; a local build asks git. */
function buildCommit(): string {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7)
  try {
    const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    const dirty = execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim()
    return dirty ? `${head}+changes` : head
  } catch {
    return 'unknown'
  }
}

const builtAt = Date.now()

export default defineConfig({
  plugins: [react(), channelApi()],
  // Each build has its own id; channel pools kept by an earlier build are never reused by a later one.
  define: {
    __TVN_BUILD__: JSON.stringify(builtAt.toString(36)),
    __TVN_COMMIT__: JSON.stringify(buildCommit()),
    __TVN_BUILT_AT__: JSON.stringify(new Date(builtAt).toISOString()),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'harvester/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
