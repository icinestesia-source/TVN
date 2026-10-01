import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.gen.ts'],
    testTimeout: 600_000,
  },
})
