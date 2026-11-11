/** @description 本机开发入口与API代理；原生HTTP接收期限覆盖安装包总时限，避免慢速隧道上传被截断。 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { artifactLimits } from '@release-harbor/contracts'
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'artifact-upload-timeout',
      configureServer({ httpServer }) {
        // Node默认在五分钟终止整个请求；前置代理须覆盖API的一小时总期限及失败回写余量。
        // API仍独立执行无进度时限、实际长度、摘要与配额校验。
        if (httpServer && 'requestTimeout' in httpServer)
          httpServer.requestTimeout = artifactLimits.uploadTimeoutMs + 5000
      },
    },
  ],
  server: {
    // 允许通过当前 cpolar 公网域名访问。
    allowedHosts: ['6e03b6cd.r20.vip.cpolar.cn'],
    proxy: { '/api': `http://127.0.0.1:${process.env.RELEASE_HARBOR_PORT || '4399'}` },
  },
})
