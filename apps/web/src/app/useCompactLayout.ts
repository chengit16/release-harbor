/** @description 根据实际媒体查询调整导航方向，并在卸载时移除监听。 */
import { useEffect, useState } from 'react'

/** 与工作台紧凑 CSS 断点一致；横屏手机也使用抽屉和卡片，保留状态与下一步的可见空间。 */
export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 991px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 991px)')
    const handleChange = () => setCompact(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])
  return compact
}
