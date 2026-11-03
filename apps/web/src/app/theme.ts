/** @description Ant Design 白色主题入口，统一中性色阶，不覆盖组件内部 DOM。 */
import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

/** 常见控件的共享视觉 Token；CSS 仅维护品牌布局与业务选择卡片。 */
export const harborTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#334155',
    colorInfo: '#334155',
    colorInfoBg: '#f8fafc',
    colorInfoBorder: '#e2e8f0',
    colorText: '#1f2937',
    colorTextSecondary: '#64748b',
    colorBorder: '#e2e8f0',
    colorBorderSecondary: '#e5e7eb',
    colorBgBase: '#ffffff',
    colorBgLayout: '#fafbfc',
    colorBgContainer: '#ffffff',
    borderRadius: 6,
    fontFamily: "'Avenir Next', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 13,
    controlHeight: 38,
    motion: false,
  },
  components: {
    Menu: {
      itemBg: '#ffffff',
      itemColor: '#64748b',
      itemSelectedBg: '#f1f5f9',
      itemSelectedColor: '#1f2937',
      itemHoverBg: '#f8fafc',
      itemHeight: 46,
      horizontalItemSelectedBg: '#f1f5f9',
      horizontalItemSelectedColor: '#1f2937',
    },
    Card: { headerFontSize: 15 },
  },
}
