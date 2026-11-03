/** @description 用 URL 保存项目与应用定位，浏览器后退同步选择，不保存身份或授权。 */
import { useEffect, useState } from 'react'

function read() {
  const params = new URLSearchParams(window.location.search)
  return { projectId: params.get('project') ?? '', applicationId: params.get('application') ?? '' }
}

/** 导航只改变资源定位，所有读取仍由服务端核对归属。 */
export function useSelection() {
  const [selection, setSelection] = useState(read)
  useEffect(() => {
    const handlePop = () => setSelection(read())
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])
  function select(projectId = '', applicationId = ''): void {
    const url = new URL(window.location.href)
    for (const [key, value] of [
      ['project', projectId],
      ['application', applicationId],
    ]) {
      if (key && value) url.searchParams.set(key, value)
      else if (key) url.searchParams.delete(key)
    }
    window.history.pushState(null, '', url)
    setSelection({ projectId, applicationId })
  }
  return { ...selection, select }
}
