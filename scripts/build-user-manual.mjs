/**
 * @description 将中文操作手册转换为可离线阅读的单文件 HTML。
 * 仅从固定文档及图片目录读取，通过现有 Prettier Markdown 解析器生成转义后的正文；
 * 不访问账号、业务数据或网络，不改变工作台功能。截图以内嵌图片保留，方便单文件分享。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsers } from 'prettier/plugins/markdown'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(root, 'docs/guides/user-manual.md')
const imageRoot = resolve(dirname(source), 'assets/user-manual')
const escape = (text = '') =>
  String(text).replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  })
const plain = (node) => node.value ?? node.children?.map(plain).join('') ?? ''
const headingId = (node) =>
  plain(node)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s/g, '-')

/** 仅允许文档内锚点、本地相对路径与 HTTPS 参考链接，拒绝主动执行协议。 */
function safeLink(url) {
  if (/^(#|https:\/\/)/.test(url) || (!/[:\\]/.test(url) && !url.startsWith('/')))
    return escape(url)
  throw Error(`手册链接格式不支持：${url}`)
}

/** 固定白名单目录内的 PNG 才可嵌入；不按文档输入读取其他本机文件。 */
async function renderImage(node) {
  const path = resolve(dirname(source), node.url)
  if (!path.startsWith(imageRoot + sep) || !path.endsWith('.png'))
    throw Error(`手册图片越出固定目录：${node.url}`)
  const bytes = await readFile(path)
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw Error(`手册图片不是 PNG：${node.url}`)
  return `<figure><img src="data:image/png;base64,${bytes.toString('base64')}" alt="${escape(node.alt)}" /><figcaption>${escape(node.alt)} · 隔离演示数据</figcaption></figure>`
}

/** 按语义渲染手册使用的 Markdown 节点；遇到未支持格式直接失败，避免静默丢失内容。 */
async function render(node) {
  if (node.type === 'image') return renderImage(node)
  const content = (await Promise.all((node.children ?? []).map(render))).join('')
  switch (node.type) {
    case 'root':
      return content
    case 'heading':
      return `<h${node.depth} id="${headingId(node)}">${content}</h${node.depth}>`
    case 'paragraph':
      return node.children.some((child) => child.type === 'image') ? content : `<p>${content}</p>`
    case 'text':
      return escape(node.value)
    case 'strong':
      return `<strong>${content}</strong>`
    case 'emphasis':
      return `<em>${content}</em>`
    case 'inlineCode':
      return `<code>${escape(node.value)}</code>`
    case 'code':
      return `<pre><code>${escape(node.value)}</code></pre>`
    case 'link':
      return `<a href="${safeLink(node.url)}">${content}</a>`
    case 'list':
      return node.ordered ? `<ol>${content}</ol>` : `<ul>${content}</ul>`
    case 'listItem':
      return `<li>${content}</li>`
    case 'table': {
      const [header, ...rows] = node.children
      const cells = await Promise.all(header.children.map(render))
      return `<div class="table-wrap"><table><thead><tr>${cells.join('').replaceAll('<td>', '<th>').replaceAll('</td>', '</th>')}</tr></thead><tbody>${(await Promise.all(rows.map(render))).join('')}</tbody></table></div>`
    }
    case 'tableRow':
      return `<tr>${content}</tr>`
    case 'tableCell':
      return `<td>${content}</td>`
    default:
      throw Error(`手册包含未支持的 Markdown 格式：${node.type}`)
  }
}

const ast = await parsers.markdown.parse(await readFile(source, 'utf8'))
// 适用版本与日期取自正文，避免目录栏在下次更新时仍显示旧版本。
const edition = plain(ast.children.find((node) => node.type === 'paragraph') ?? {})
const metadata = /^适用版本：(.+) · 更新日期：(\d{4}-\d{2}-\d{2})$/.exec(edition)
if (!metadata) throw Error('手册缺少适用版本或更新日期')
const content = await render(ast)
const sections = ast.children.filter((node) => node.type === 'heading' && node.depth === 2)
const navigation = sections
  .filter((node) => plain(node) !== '目录')
  .map((node) => `<a href="#${headingId(node)}">${escape(plain(node))}</a>`)
  .join('')
const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Release Harbor 本机工作台图文操作手册：应用、账号、发布、审核与维护。" />
<title>Release Harbor 图文操作手册</title>
<style>
/* 阅读附件使用独立命名空间，屏幕双栏目录和打印正文不影响工作台样式。 */
:root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #203047; background: #f3f6fa; }
* { box-sizing: border-box; }
body { margin: 0; line-height: 1.85; }
a { color: #1763c9; text-underline-offset: 3px; }
.manual-nav { position: fixed; inset: 0 auto 0 0; width: 260px; padding: 30px 24px; overflow: auto; background: #fff; border-right: 1px solid #dce4ee; }
.manual-brand { display: block; font-size: 21px; margin-bottom: 6px; }
.manual-nav small { color: #607086; }
.manual-nav nav { margin-top: 24px; }
.manual-nav a { display: block; padding: 7px 0; font-size: 13px; text-decoration: none; }
main { margin-left: 260px; padding: 48px 5vw; max-width: 1360px; }
article { background: #fff; padding: 40px 48px; border: 1px solid #dce4ee; border-radius: 12px; }
h1 { font-size: 34px; line-height: 1.4; margin: 0 0 20px; color: #172b49; }
h2 { font-size: 25px; line-height: 1.5; margin: 56px 0 22px; padding-top: 18px; border-top: 2px solid #e3ebf6; scroll-margin-top: 24px; }
h3 { font-size: 19px; margin: 30px 0 14px; }
p { margin: 15px 0; }
li { padding-left: 5px; margin: 8px 0; }
li p { margin: 0; }
strong { color: #172b49; }
code { font-size: .91em; overflow-wrap: anywhere; background: #f1f5fa; padding: 2px 5px; border-radius: 4px; }
pre { padding: 18px; background: #f1f5fa; overflow-x: auto; border-left: 3px solid #1763c9; }
pre code { padding: 0; }
.table-wrap { overflow-x: auto; margin: 22px 0; }
table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.7; }
th, td { border: 1px solid #dce4ee; padding: 11px 13px; text-align: left; vertical-align: top; min-width: 100px; }
th { background: #eef4fd; color: #172b49; }
figure { margin: 28px 0; padding: 12px; border: 1px solid #dce4ee; border-radius: 8px; background: #f8fafc; }
figure img { display: block; max-width: 100%; height: auto; margin-inline: auto; }
figcaption { margin-top: 12px; color: #607086; font-size: 13px; }
.manual-footer { margin-top: 35px; font-size: 13px; color: #607086; }
@media (max-width: 1000px) { .manual-nav { position: static; width: auto; padding: 20px; } .manual-nav nav { display: none; } main { margin: 0; padding: 20px; } article { padding: 24px; } h1 { font-size: 28px; } }
@media (max-width: 480px) { main { padding: 10px; } article { padding: 20px 14px; } h2 { font-size: 22px; } figure { padding: 6px; } }
@media print { @page { size: A4; margin: 15mm; } :root { background: white; } .manual-nav { display: none; } main { margin: 0; padding: 0; max-width: none; } article { border: 0; padding: 0; } body { font-size: 10pt; } h1 { font-size: 24pt; } h2 { break-before: page; margin-top: 0; font-size: 18pt; } h3 { break-after: avoid; } figure { break-inside: avoid; padding: 0; border: 0; } figure img { width: auto; max-width: 100%; max-height: 225mm; margin: auto; } table { font-size: 9pt; } tr { break-inside: avoid; } a { color: inherit; } }
</style></head>
<body><aside class="manual-nav"><strong class="manual-brand">Release Harbor</strong><small>${escape(metadata[1])}<br />${escape(metadata[2])} · 可离线阅读／浏览器打印</small><nav aria-label="手册目录">${navigation}</nav></aside>
<main><article>${content}<p class="manual-footer">本阅读附件由 scripts/build-user-manual.mjs 根据 Markdown 与隔离截图生成。截图为演示数据，不代表实际商店验收。</p></article></main></body></html>`
await writeFile(resolve(dirname(source), 'user-manual.html'), html)
console.log(`图文手册已生成：${sections.length - 1} 个章节，图片已内嵌。`)
