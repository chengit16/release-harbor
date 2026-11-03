/** @description 浏览器验收截图工具，统一等待布局提交，不参与业务或凭据处理。 */
/** 全页截图前回到顶端并等待布局提交，避免 sticky 导航留在旧滚动位置。 */
export async function captureScreenshot(page, path) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.scrollTo(0, 0)
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
  )
  await page.screenshot({ path, fullPage: true })
}
