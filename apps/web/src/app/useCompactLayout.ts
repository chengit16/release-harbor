/** @description 根据实际媒体查询调整导航方向，并在卸载时移除监听。 */
import { useEffect, useState } from 'react'

/** 与工作台窄屏 CSS 断点一致，避免桌面菜单挤占手机内容。 */
export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const handleChange = () => setCompact(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])
  return compact
}
