import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    // 允许通过当前 cpolar 公网域名访问。
    allowedHosts: ['6e03b6cd.r20.vip.cpolar.cn'],
    proxy: { '/api': `http://127.0.0.1:${process.env.RELEASE_HARBOR_PORT || '4399'}` },
  },
})
