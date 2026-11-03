/** @description 工作台品牌标记，仅负责展示，不依赖业务或路由。 */
/** 品牌标记尺寸。 */
export interface BrandMarkProps {
  /** 紧凑版本用于空状态。 */
  small?: boolean
}
/** 装饰图形不参与可访问名称。 */
export function BrandMark({ small = false }: BrandMarkProps) {
  return (
    <span className={'brand-mark' + (small ? ' small' : '')} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <path
          d="M10 8v15c0 6 4 9 10 9s10-3 10-9V8M5 18h30M20 4v31"
          stroke="currentColor"
          strokeWidth="2.4"
        />
        <circle cx="20" cy="7" r="3" fill="currentColor" />
      </svg>
    </span>
  )
}
