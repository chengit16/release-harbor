/** @description Web 入口，统一 Ant Design 中文与主题，业务层不重复装配组件库。 */
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { App } from './App'
import { harborTheme } from './app/theme.ts'
import { harborTagConfig } from './app/tagTheme.ts'
import { harborCssVariables } from './app/palette.ts'
import './style.css'
// 首次渲染前同步根变量，弹窗与页面都继承色板，避免两套手写颜色再次漂移。
for (const [name, value] of Object.entries(harborCssVariables))
  document.documentElement.style.setProperty(name, value)
const root = document.getElementById('root')
if (!root) throw new Error('缺少工作台根节点')
createRoot(root).render(
  <ConfigProvider locale={zhCN} theme={harborTheme} tag={harborTagConfig}>
    <App />
  </ConfigProvider>,
)
