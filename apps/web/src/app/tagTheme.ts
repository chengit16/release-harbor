/** @description 全局轻量标签样式；只统一呈现，不推断业务状态或改变标签文案。 */
import type { ConfigProviderProps } from 'antd'
import { harborPalette as colors, harborTagText } from './palette.ts'

const tones = {
  neutral: { color: colors.secondary, backgroundColor: colors.fill },
  info: { color: colors.accent, backgroundColor: colors.accentBg },
  success: { color: harborTagText.success, backgroundColor: colors.successBg },
  warning: { color: harborTagText.warning, backgroundColor: colors.warningBg },
  error: { color: harborTagText.error, backgroundColor: colors.errorBg },
}

// 兼容现有页面的预设色名与状态色名，避免同一种状态因为调用方式不同出现两套配色。
const toneAliases: Record<string, keyof typeof tones> = {
  default: 'neutral',
  blue: 'info',
  cyan: 'info',
  geekblue: 'info',
  processing: 'info',
  green: 'success',
  lime: 'success',
  success: 'success',
  gold: 'warning',
  yellow: 'warning',
  orange: 'warning',
  warning: 'warning',
  red: 'error',
  volcano: 'error',
  error: 'error',
}

/** 统一现有 Ant Design Tag 的尺寸与浅色语义外观，显式变体、禁用及局部换行设置仍由组件保留。 */
export const harborTagConfig: NonNullable<ConfigProviderProps['tag']> = {
  variant: 'filled',
  styles: ({ props }) => {
    const tone = toneAliases[props.color ?? 'default']
    // 显式实心／描边和禁用态继续使用组件规则，未知自定义颜色也不擅自改成中性色。
    const soft = props.variant === 'filled' && !props.disabled
    return {
      root: {
        borderRadius: 2,
        fontSize: 12,
        // 中文中等字重会放大状态标签的视觉重量，常规字重配合紧凑留白贴近列表参考。
        fontWeight: 400,
        lineHeight: '20px',
        paddingInline: 6,
        paddingBlock: 0,
        verticalAlign: 'middle',
        boxShadow: 'none',
        ...(soft ? { border: 'none', ...(tone ? tones[tone] : {}) } : {}),
      },
    }
  },
}
