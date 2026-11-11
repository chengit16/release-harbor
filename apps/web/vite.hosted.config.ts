/** @description 独立构建在线目录，避免与本机 dist 混用。 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('./hosted/', import.meta.url)),
  plugins: [react()],
})
