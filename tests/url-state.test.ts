/** @description URL 导航回归：跨菜单隔离页面状态，保留当前深链与浏览器历史语义；不调用业务 API。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseCenterUrl, updateUrlState } from '../apps/web/src/app/useUrlState.ts'

import { normalizeWorkbenchSearch } from '../apps/web/src/app/urlNavigation.ts'

/** 用浏览器同形历史验证真实更新入口；不模拟页面自身的清理实现。 */
function withWindow(search: string, run: (location: URL, writes: string[]) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const location = new URL('http://localhost/' + search)
  const writes: string[] = []
  let historyState: unknown = null
  const history = {
    get state() {
      return historyState
    },
    pushState: (state: unknown, _title: string, url: URL) => {
      historyState = state
      location.href = url.href
      writes.push('push')
    },
    replaceState: (state: unknown, _title: string, url: URL) => {
      historyState = state
      location.href = url.href
      writes.push('replace')
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location, history, dispatchEvent: () => true },
  })
  try {
    run(location, writes)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

const pollutedWorkspace =
  '?view=releases&releaseTask=workspace&project=p&application=a' +
  '&releaseCompose=configured&releaseSelected=b1,b2&releaseView=batch' +
  '&releaseProject=p&releaseApplication=a&releaseChannel=huawei' +
  '&issueStatus=resolved&localTab=runtime&helpTab=roadmap'

test('从发布页切换所有菜单均不携带其他页面参数', () => {
  for (const view of [
    'accounts',
    'projects',
    'reviews',
    'settings',
    'help',
    'channels',
    'issues',
    'roadmap',
  ]) {
    withWindow(pollutedWorkspace, (location, writes) => {
      updateUrlState({ view })
      assert.equal(location.search, '?view=' + view)
      assert.deepEqual(writes, ['push'])
    })
  }
})

test('旧长链接原位清理，保留已选渠道且不重复写入历史', () => {
  withWindow(pollutedWorkspace, (location, writes) => {
    updateUrlState({}, true)
    assert.equal(
      location.search,
      '?view=releases&project=p&application=a&releaseTask=workspace' +
        '&releaseCompose=configured&releaseSelected=b1%2Cb2',
    )
    assert.equal(
      releaseCenterUrl().search,
      '?view=releases&releaseProject=p&releaseApplication=a&releaseChannel=huawei',
    )
    updateUrlState({}, true)
    assert.deepEqual(writes, ['replace'])
  })
})

test('发布详情 URL 不重复列表筛选，刷新后返回仍恢复原筛选和分页', () => {
  withWindow('?view=releases&releaseChannel=xiaomi&releasePage=3', (location) => {
    updateUrlState({ releaseTask: 'workspace', project: 'p', application: 'a', plan: 'plan-1' })
    assert.equal(
      location.search,
      '?view=releases&project=p&application=a&releaseTask=workspace&plan=plan-1',
    )
    // 刷新时原历史项仍在，规范化不能清除返回上下文；关闭详情后也继续保留。
    updateUrlState({}, true)
    updateUrlState({ plan: '' })
    assert.equal(releaseCenterUrl().search, '?view=releases&releaseChannel=xiaomi&releasePage=3')
    updateUrlState({ releaseTask: '' })
    assert.equal(location.search, '?view=releases&releaseChannel=xiaomi&releasePage=3')
  })
})

test('跨页深链只携带显式目标，离开工作区不将返回筛选带给其他菜单', () => {
  withWindow('?view=accounts&releaseChannel=xiaomi', () => {
    updateUrlState({ view: 'releases', releaseTask: 'workspace', project: 'p', application: 'a' })
    assert.equal(releaseCenterUrl().search, '?view=releases')
  })
  withWindow(pollutedWorkspace, (location) => {
    updateUrlState({}, true)
    updateUrlState({ view: 'projects', project: 'p', application: 'a', tab: 'bindings' })
    assert.equal(location.search, '?view=projects&project=p&application=a')
    updateUrlState({ view: 'releases', releaseTask: 'workspace', project: 'p', application: 'a' })
    assert.equal(releaseCenterUrl().search, '?view=releases')
  })
})

test('各菜单及页签只保留自身筛选、分页和记录定位，省略默认参数', () => {
  const cases = [
    ['view=help&helpTab=roadmap&issueStatus=resolved&issuePage=2', 'view=help&helpTab=roadmap'],
    [
      'view=help&helpTab=issues&issueStatus=resolved&issuePage=2',
      'view=help&helpTab=issues&issueStatus=resolved&issuePage=2',
    ],
    ['view=help&helpTab=channels', 'view=help'],
    ['view=issues&issue=RH-0001&issuePage=1&helpTab=roadmap', 'view=issues&issue=RH-0001'],
    [
      'view=settings&localTab=runtime&storageStatus=ready&storagePage=2',
      'view=settings&localTab=runtime',
    ],
    [
      'view=settings&localTab=storage&storageSearch=apk&storagePage=2',
      'view=settings&storageSearch=apk&storagePage=2',
    ],
    [
      'view=projects&applicationProject=p&applicationPage=2&storagePage=2',
      'view=projects&applicationProject=p&applicationPage=2',
    ],
    [
      'view=projects&project=p&application=a&tab=artifacts&artifactStoragePage=2',
      'view=projects&project=p&application=a&tab=artifacts&artifactStoragePage=2',
    ],
    [
      'view=projects&project=p&application=a&tab=preflight&artifactStoragePage=2&applicationPage=2',
      'view=projects&project=p&application=a&tab=preflight',
    ],
    [
      'view=accounts&accountChannel=huawei&accountDetail=account&releaseChannel=xiaomi',
      'view=accounts&accountChannel=huawei&accountDetail=account',
    ],
    [
      'view=reviews&reviewMode=follows&followSearch=app&followPage=2&reviewProject=p&storePage=2',
      'view=reviews&reviewMode=follows&followSearch=app&followPage=2',
    ],
    [
      'view=reviews&reviewMode=todos&reviewChannel=huawei&reviewTarget=b&storeTodo=rejected&storePage=2&followPage=3',
      'view=reviews&reviewMode=todos&reviewChannel=huawei&reviewTarget=b&storePage=2&storeTodo=rejected',
    ],
    [
      'view=reviews&reviewMode=store&reviewTarget=b&reviewState=rejected&reviewPage=2&storePage=2',
      'view=reviews&reviewTarget=b&storePage=2',
    ],
    ['view=releases&releasePage=1&localTab=runtime', 'view=releases'],
  ]
  for (const [input, expected] of cases) {
    assert.ok(input && expected)
    const normalized = normalizeWorkbenchSearch(new URLSearchParams(input)).toString()
    assert.equal(normalized, expected, input)
    assert.equal(normalizeWorkbenchSearch(new URLSearchParams(normalized)).toString(), expected)
  }
})

test('旧发布、配置和审核深链保留原记录身份', () => {
  const cases = [
    [
      'project=p&application=a&tab=plans&plan=old',
      'view=releases&project=p&application=a&releaseTask=workspace&plan=old',
    ],
    [
      'view=projects&project=p&application=a&tab=plans&releaseView=batch&batch=b&batchRevision=r',
      'view=releases&project=p&application=a&releaseTask=workspace&releaseView=batch&batch=b&batchRevision=r',
    ],
    [
      'view=projects&project=p&application=a&tab=apple-review&appleRecord=old',
      'view=releases&project=p&application=a&releaseTask=workspace&releaseApple=review&appleRecord=old',
    ],
    [
      'view=releases&project=p&application=a&tab=artifacts&plan=old',
      'view=projects&project=p&application=a&tab=artifacts',
    ],
    [
      'view=reviews&reviewRecord=plan:old&reviewProject=p',
      'view=reviews&reviewMode=history&reviewProject=p&reviewRecord=plan%3Aold',
    ],
  ]
  for (const [input, expected] of cases) {
    assert.ok(input && expected)
    assert.equal(normalizeWorkbenchSearch(new URLSearchParams(input)).toString(), expected)
  }
})

test('发布模式互斥，切换 Apple 或重选渠道清除不再生效的状态', () => {
  withWindow(pollutedWorkspace, (location) => {
    updateUrlState({ releaseCompose: '1' })
    assert.equal(
      location.search,
      '?view=releases&project=p&application=a&releaseTask=workspace&releaseCompose=1',
    )
    updateUrlState({ releaseApple: 'review', appleRecord: 'apple-1' })
    assert.equal(
      location.search,
      '?view=releases&project=p&application=a&releaseTask=workspace&releaseApple=review&appleRecord=apple-1',
    )
    updateUrlState({
      releaseApple: '',
      releaseView: 'batch',
      batch: 'batch-1',
      batchRevision: 'r1',
    })
    assert.equal(
      location.search,
      '?view=releases&project=p&application=a&releaseTask=workspace&releaseView=batch&batch=batch-1&batchRevision=r1',
    )
    updateUrlState({ releaseView: '', plan: 'plan-1' })
    assert.equal(
      location.search,
      '?view=releases&project=p&application=a&releaseTask=workspace&plan=plan-1',
    )
  })
})
