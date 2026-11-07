/** @description 跟踪与待办浏览器验收；隔离合成绑定验证人工记录、指定构建、资料提示及导航零商店请求。 */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 所有发布相关动作只验证跳转，不确认送审或上线；材料和商店响应均为合成数据。 */
export async function runStoreTrackingSmoke(page, origin, projectId) {
  const headers = { 'content-type': 'application/json' }
  const targets = []
  for (const channel of ['xiaomi', 'oppo', 'app_store']) {
    const base = `${origin}/api/projects/${projectId}/applications`
    const created = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `跟踪验收 ${channel}`,
        platform: channel === 'app_store' ? 'ios' : 'android',
        identifier: `com.example.tracking.${channel.replace('_', '')}`,
      }),
    })
    assert.equal(created.status, 201)
    const application = (await created.json()).application
    const bound = await fetch(`${base}/${application.id}/bindings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        channel,
        appId: channel === 'app_store' ? '789014' : application.identifier,
        credentialReference: 'synthetic-tracking-account',
      }),
    })
    assert.equal(bound.status, 201)
    targets.push({ channel, application, binding: (await bound.json()).binding, base })
  }
  const before = await Promise.all(
    targets.map(async (t) => (await fetch(`${t.base}/${t.application.id}/release-plans`)).text()),
  )
  let queries = 0
  const listener = (r) => {
    if (r.method() === 'POST' && /\/(query|materials)$/.test(new URL(r.url()).pathname)) queries++
  }
  page.on('request', listener)
  const detail = page.getByRole('dialog', { name: '商店状态详情', exact: true })
  for (const t of targets) {
    await page.goto(
      `${origin}/?${new URLSearchParams({ view: 'reviews', reviewProject: projectId, reviewApplication: t.application.id, reviewTarget: t.binding.id })}`,
    )
    await detail.getByRole('button', { name: '查询商店状态', exact: true }).waitFor()
    if (t.channel === 'oppo') {
      await detail.getByRole('textbox', { name: 'OPPO 构建号' }).fill('42')
      await detail.getByRole('button', { name: '按构建号查询' }).click()
      const scope = detail.getByRole('region', { name: '指定构建 42', exact: true })
      await scope.getByText('审核未通过', { exact: true }).waitFor()
      await scope.getByText('构建号 42', { exact: false }).first().waitFor()
      await detail.getByText('尚未查询商店状态', { exact: true }).waitFor()
    } else {
      await detail.getByRole('button', { name: '查询商店状态', exact: true }).click()
      if (t.channel === 'app_store') {
        await detail.getByText('等待手动发布', { exact: true }).waitFor()
        await detail.getByText('待补齐', { exact: true }).waitFor()
        await detail.getByText('历史版本（1）', { exact: true }).click()
        await detail.getByText('已被新版本替代', { exact: true }).waitFor()
        // 状态与资料共用真实冷却，不能让夹具绕过生产防重复策略。
        await delay(10100)
        await detail.getByRole('button', { name: '检查所选版本资料', exact: true }).click()
        await detail.getByText('审核联系人', { exact: false }).first().waitFor()
        await detail.getByText('各语言版本描述', { exact: false }).first().waitFor()
        await detail.getByText('未检查', { exact: true }).first().waitFor()
        await detail.getByText('资料读取时间：', { exact: false }).waitFor()
        const materialText = await detail.innerText()
        assert.ok(!materialText.includes('private-review-password'))
        assert.ok(!materialText.includes('synthetic@example.com'))
      } else {
        await detail.getByText('公开在架', { exact: true }).waitFor()
        await detail.getByRole('button', { name: '添加人工核对' }).click()
        await detail.getByLabel('核对版本', { exact: true }).fill('4.0.0')
        await detail.getByLabel('核对构建号（可选）').fill('40')
        await detail.getByLabel('后台状态').click()
        await page
          .locator('.ant-select-dropdown:visible')
          .getByText('审核未通过', { exact: true })
          .click()
        const local = new Date(Date.now() - 60000)
        const value = new Date(local.getTime() - local.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
        await detail.getByLabel('实际核对时间（本机时区）').fill(value)
        await detail.getByLabel('处理备注').fill('合成资料核对')
        // 首次失败必须保留表单，修复网络后的同输入重试只追加一条。
        await page.route(
          '**/api/store-status/**/manual',
          (route) => route.fulfill({ status: 503, json: { message: '合成保存失败' } }),
          { times: 1 },
        )
        await detail.getByRole('button', { name: '保存人工记录' }).click()
        await detail.getByRole('alert').filter({ hasText: '合成保存失败' }).waitFor()
        assert.equal(await detail.getByLabel('核对版本', { exact: true }).inputValue(), '4.0.0')
        await detail.getByRole('button', { name: '保存人工记录' }).click()
        await detail.getByText('人工核对已保存', { exact: true }).waitFor()
        await detail.getByText('合成资料核对', { exact: true }).waitFor()
        assert.equal(await detail.getByText('人工核对', { exact: true }).count(), 1)
      }
    }
    const count = queries
    await page.reload()
    await detail.getByRole('heading', { name: '资料检查', exact: true }).waitFor()
    assert.equal(queries, count)
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(
        await detail.evaluate((el) => el.scrollWidth <= el.clientWidth),
        `${t.channel} 跟踪详情溢出`,
      )
      await captureScreenshot(page, `artifacts/store-tracking-${t.channel}-${width}.png`)
      if (t.channel === 'app_store') {
        const materials = detail.getByRole('region', { name: 'Apple指定版本资料检查' })
        await materials.getByText('资料读取时间：', { exact: false }).waitFor()
        assert.ok(await materials.evaluate((el) => el.scrollWidth <= el.clientWidth))
        await materials.screenshot({ path: `artifacts/apple-materials-${width}.png` })
      }
    }
    await detail.getByRole('button', { name: '关闭商店详情' }).click()
    await page.getByRole('tab', { name: '待办处理', exact: true }).click()
    const todo = page.getByRole('region', { name: '商店待办', exact: true })
    await todo
      .getByText(t.channel === 'app_store' ? '等待手动发布' : '审核需处理', { exact: true })
      .first()
      .waitFor()
    if (t.channel === 'xiaomi') await todo.getByText('人工核对', { exact: true }).waitFor()
    if (t.channel === 'app_store') {
      await todo.getByText('资料待完善', { exact: true }).waitFor()
      assert.equal(await todo.getByText('已被新版本替代', { exact: true }).count(), 0)
    }
    await page.reload()
    await todo.getByRole('button', { name: '查看处理详情' }).first().waitFor()
    assert.equal(new URL(page.url()).searchParams.get('reviewMode'), 'todos')
    await todo.getByRole('button', { name: '查看处理详情' }).first().click()
    await detail.getByRole('heading', { name: '资料检查', exact: true }).waitFor()
    await page.goBack()
    await todo.getByRole('button', { name: '查看处理详情' }).first().waitFor()
    assert.equal(queries, count)
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        '待办窄屏溢出',
      )
      const title = await page.getByRole('heading', { name: '审核状态', exact: true }).boundingBox()
      const content = await page
        .getByRole('region', { name: '商店状态查询', exact: true })
        .boundingBox()
      assert.ok(title && content && Math.abs(title.x - content.x) <= 2, '待办未对齐')
      if (width === 375)
        assert.ok(
          await todo
            .locator('.store-todo-content')
            .evaluateAll((elements) =>
              elements.every((element) => element.getBoundingClientRect().width >= 200),
            ),
          '手机待办正文被按钮压成窄列',
        )
      await captureScreenshot(page, `artifacts/store-todos-${t.channel}-${width}.png`)
    }
  }
  assert.equal(queries, 4)
  assert.deepEqual(
    await Promise.all(
      targets.map(async (t) => (await fetch(`${t.base}/${t.application.id}/release-plans`)).text()),
    ),
    before,
  )
  page.off('request', listener)
  await page.setViewportSize({ width: 1440, height: 1000 })
}
