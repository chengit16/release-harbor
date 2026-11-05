/** @description 魅族普通应用来源与资料复用；私人备案字段仅在进程内传递，不参与公开摘要。 */
import {
  isRecord,
  isStoreId,
  isMeizuUpdateDetails,
  type MeizuUpdateDetails,
} from '@release-harbor/contracts'
import { planFingerprint } from '@release-harbor/domain'
import { StoreRequestError, storeScalar, storeRequest, type StoreSession } from './store-client.ts'

/** 公开展示字段用于发现同版本编辑，证件、联系人和私人备案资料不参与摘要。 */
const publicNames = [
  'name',
  'appDescription',
  'keyword',
  'recommendDesc',
  'authorName',
  'categoryId',
  'category2Id',
  'tagId',
  'ageBracket',
  'privacyPolicyUrl',
  'softwareAuthorNum',
  'qualifcation',
  'dwmc',
  'yylb',
  'zbzShengId',
]
/** 接口使用不同字段名；只复制明确要求的值，不展开完整平台详情。 */
const textMap = {
  appName: 'name',
  appDesc: 'appDescription',
  authorName: 'authorName',
  icon: 'icon',
  privacyPolicyUrl: 'privacyPolicyUrl',
  keyword: 'keyword',
  recommendDesc: 'recommendDesc',
  softwareAuthorNum: 'softwareAuthorNum',
  devContact: 'devContact',
  qualifcation: 'qualifcation',
  dwmc: 'dwmc',
  zjhm: 'zjhm',
  yyzmc: 'yyzmc',
  yyzzjhm: 'yyzzjhm',
  yyzlxrlxfs: 'yyzlxrlxfs',
  yylb: 'yylb',
}
const numberMap = {
  catid: 'categoryId',
  cat2id: 'category2Id',
  tagId: 'tagId',
  ageBracket: 'ageBracket',
  zjlx: 'zjlx',
  yyzzjlx: 'yyzzjlx',
  zbzShengId: 'zbzShengId',
}
/** 列表与详情均须保持已上架；明确的待审修改不能被来源版本状态掩盖。 */
function assertUpdatableState(value: Record<string, unknown>): void {
  if (value.status !== 50) throw new StoreRequestError('meizu_not_on_shelf')
  const replacement = value.replaceStatus
  // 实际只读响应以数字 -1 表示未报告修改审核；官方 0／1 分别为同版本替换／资料修改待审。
  // 只兼容该确定哨兵，不把字符串、其他整数或布尔值当作“没有待审”。
  if (replacement === undefined || replacement === null || replacement === -1) return
  if (replacement === 0 || replacement === 1) throw new StoreRequestError('meizu_pending_changes')
  throw new StoreRequestError('store_source_invalid')
}
/** 有界字段必需完整；缺失时停止，不用空值覆盖现有备案材料。 */
export function meizuMaterials(detail: Record<string, unknown>): {
  summary: MeizuUpdateDetails
  fields: Record<string, unknown>
} {
  // 1. 只复用官方要求的文本和整数白名单，拒绝缺失资料，不能展开原始详情。
  const fields: Record<string, unknown> = {}
  for (const [key, from] of Object.entries(textMap)) {
    const v = detail[from]
    // 推荐语是发布必填项，历史已上架版本仍可能为空；明确引导补齐，不能自动编造或提交空值。
    if (key === 'recommendDesc' && (v == null || (typeof v === 'string' && !v.trim())))
      throw new StoreRequestError('meizu_recommendation_missing')
    if (
      typeof v !== 'string' ||
      !v.trim() ||
      v.length > 16000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)
    )
      throw new StoreRequestError('store_source_invalid')
    fields[key] = v
  }
  for (const [key, from] of Object.entries(numberMap)) {
    const v = detail[from]
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
      throw new StoreRequestError('store_source_invalid')
    fields[key] = v
  }
  if (fields.catid !== 1) throw new StoreRequestError('store_target_not_ready')
  // 2. 文件路径沿用官方详情，公开摘要只使用无查询参数的资源标识，避免对签名令牌计算指纹。
  for (const key of ['screenShots', 'certificates']) {
    const value = detail[key],
      values = key === 'certificates' && typeof value === 'string' ? value.split(',') : value
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 20 ||
      !values.every(
        (v) =>
          typeof v === 'string' && v.length > 0 && v.length <= 8192 && !/[\x00-\x1f\x7f]/.test(v),
      )
    )
      throw new StoreRequestError('store_source_invalid')
    fields[key] = values
  }
  // 3. 版本锚点和公开摘要可以出进程；联系人、证件仅保留在 fields 中即时回传同一平台。
  const summary = {
    sourceVersionId: storeScalar(detail.verId),
    sourceVersionName: storeScalar(detail.versionName),
    appName: storeScalar(detail.name),
    publicDigest: planFingerprint({
      ...Object.fromEntries(publicNames.map((k) => [k, detail[k]])),
      assets: [fields.icon, fields.screenShots, fields.certificates]
        .flat()
        .map((v) => (typeof v === 'string' ? v.split('?')[0] : v)),
    }),
  }
  if (!isMeizuUpdateDetails(summary) || JSON.stringify(fields).length > 100000)
    throw new StoreRequestError('store_source_invalid')
  return { summary, fields }
}
/** 分页完整且唯一才匹配目标；不因第一页找到就忽略后页冲突。 */
export async function meizuTarget(
  session: StoreSession,
  identifier: string,
  appId: string,
  transport: typeof fetch,
): Promise<{ summary: MeizuUpdateDetails; fields: Record<string, unknown> }> {
  // 1. 扫描完整有界分页，后页冲突或总数变化不能被首个命中掩盖。
  const matches: Record<string, unknown>[] = []
  let total: number | undefined
  for (let start = 0; start < 1000; start += 10) {
    const r = await storeRequest(
        session,
        'list',
        { start: String(start), limit: '10' },
        undefined,
        undefined,
        transport,
      ),
      v = r.value
    if (
      !isRecord(v) ||
      !Array.isArray(v.data) ||
      v.data.length > 10 ||
      typeof v.total !== 'number' ||
      !Number.isSafeInteger(v.total) ||
      v.total < 0 ||
      v.total > 1000 ||
      (total !== undefined && total !== v.total) ||
      !v.data.every(isRecord)
    )
      throw new StoreRequestError('store_source_invalid')
    total = v.total
    matches.push(...v.data.filter((x) => x.pkgName === identifier))
    if (start + v.data.length > total) throw new StoreRequestError('store_source_invalid')
    if (start + v.data.length === total) break
    if (v.data.length !== 10) throw new StoreRequestError('store_source_invalid')
  }
  // 2. 精确匹配唯一应用及支持状态，不能覆盖后台已有待审修改。
  const item = matches[0]
  if (matches.length !== 1 || !item || storeScalar(item.id) !== appId)
    throw new StoreRequestError('store_target_mismatch')
  assertUpdatableState(item)
  const verId = storeScalar(item.verId)
  if (!isStoreId(verId)) throw new StoreRequestError('store_source_invalid')
  // 3. 用确定 verId 读取完整资料，再核对 ID、包名和状态，杜绝列表与详情混用。
  const detail = (await storeRequest(session, 'detail', { verId }, undefined, undefined, transport))
    .value
  if (
    !isRecord(detail) ||
    storeScalar(detail.id) !== appId ||
    detail.packageName !== identifier ||
    storeScalar(detail.verId) !== verId
  )
    throw new StoreRequestError('store_target_mismatch')
  assertUpdatableState(detail)
  return meizuMaterials(detail)
}
