/** @description 工作台语义色板的唯一来源；组件 Token 与页面 CSS 共用色值，不参与业务状态判断。 */

/** 中性内容面负责阅读，统一蓝色标识主操作与交互位置，状态色只表达已有的业务事实。 */
export const harborPalette = {
  text: '#262626',
  secondary: '#595959',
  // 辅助文字也会出现在浅灰画布上，需同时满足该背景的正文对比度。
  tertiary: '#6f6f6f',
  disabled: '#a6a6a6',
  surface: '#ffffff',
  canvas: '#f5f5f5',
  subtle: '#fafafa',
  fill: '#f5f5f5',
  header: '#fafafa',
  divider: '#f0f0f0',
  controlBorder: '#d9d9d9',
  accent: '#1668dc',
  accentHover: '#1259bd',
  accentActive: '#0e499b',
  accentBg: '#e6f4ff',
  accentBorder: '#91caff',
  focus: 'rgba(22, 104, 220, 0.16)',
  infoBg: '#f0f7ff',
  infoBorder: '#cce4ff',
  success: '#237804',
  successIcon: '#389e0d',
  successBg: '#f6ffed',
  successBorder: '#b7eb8f',
  warning: '#874d00',
  warningIcon: '#d48806',
  warningBg: '#fffbe6',
  warningBorder: '#ffe58f',
  error: '#b42318',
  errorIcon: '#f04438',
  errorBg: '#fff2f0',
  errorBorder: '#ffccc7',
} as const

/** 标签使用清亮的小字色阶，与浅色背景配对；独立于正文和提示面板的深色状态文字。 */
export const harborTagText = {
  success: '#2f850b',
  warning: '#a15c00',
  error: '#cf3030',
} as const

/** 挂载到文档根节点，保证懒加载页面与弹窗 Portal 读取同一套语义变量。 */
export const harborCssVariables: Record<`--${string}`, string> = {
  '--text': harborPalette.text,
  '--muted': harborPalette.secondary,
  '--subtle-text': harborPalette.tertiary,
  '--surface': harborPalette.surface,
  '--canvas': harborPalette.canvas,
  '--surface-subtle': harborPalette.subtle,
  '--surface-selected': harborPalette.fill,
  '--line': harborPalette.divider,
  '--control-line': harborPalette.controlBorder,
  '--primary': harborPalette.accent,
  '--primary-hover': harborPalette.accentHover,
  '--accent': harborPalette.accent,
  '--accent-soft': harborPalette.accentBg,
  '--accent-line': harborPalette.accentBorder,
  '--success': harborPalette.success,
  '--success-bg': harborPalette.successBg,
  '--success-line': harborPalette.successBorder,
  '--warning': harborPalette.warning,
  '--warning-bg': harborPalette.warningBg,
  '--warning-line': harborPalette.warningBorder,
  '--error': harborPalette.error,
  '--error-bg': harborPalette.errorBg,
  '--error-line': harborPalette.errorBorder,
}
