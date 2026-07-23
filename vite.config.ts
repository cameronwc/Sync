/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// On GitHub Actions, GITHUB_REPOSITORY is "owner/repo"; Pages serves from /<repo>/.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'sync'

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? `/${repoName}/` : '/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
