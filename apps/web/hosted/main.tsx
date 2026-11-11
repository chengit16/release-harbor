/** @description 在线控制台入口，沿用工作台中文主题，只加载在线目录模块。 */
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { createRoot } from 'react-dom/client'
import { harborTheme } from '../src/app/theme.ts'
import { HostedConsole } from '../src/hosted/HostedConsole.tsx'
import '../src/hosted/hosted.css'

const root = document.getElementById('root')
if (!root) throw new Error('在线控制台缺少挂载节点')
createRoot(root).render(
  <ConfigProvider locale={zhCN} theme={harborTheme} button={{ autoInsertSpace: false }}>
    <HostedConsole />
  </ConfigProvider>,
)
