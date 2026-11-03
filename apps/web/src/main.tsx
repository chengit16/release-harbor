/** @description Web 入口，统一 Ant Design 中文与主题，业务层不重复装配组件库。 */
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { App } from './App'
import { harborTheme } from './app/theme.ts'
import './style.css'
const root = document.getElementById('root')
if (!root) throw new Error('缺少工作台根节点')
createRoot(root).render(
  <ConfigProvider locale={zhCN} theme={harborTheme}>
    <App />
  </ConfigProvider>,
)
