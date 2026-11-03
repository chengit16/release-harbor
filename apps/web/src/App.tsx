import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  channelCapabilities,
  type CreateProject,
  type Project,
  type ProductStatus,
} from '@release-harbor/contracts'

type View = 'projects' | 'channels' | 'roadmap'
const frameworkNames: Record<string, string> = {
  'react-native': 'React Native',
  flutter: 'Flutter',
  native: '原生应用',
  other: '其他技术栈',
}
const phases = [
  ['本地发布闭环', '项目与应用、安装包检查、计划确认、首批商店上传。'],
  ['多渠道交付', '渠道配置、逐渠道产物分配、批次调度与独立重跑。'],
  ['审核与资料追踪', '真实状态查询、审核拒绝原因、资料检查与交付记录。'],
  ['送审与上线编排', '按渠道能力逐步接入资料更新、送审与上线动作。'],
  ['在线控制台', '组织与成员、身份隔离、对象存储、受信任执行器连接。'],
  ['团队与自动化', '可信审批、独立任务调度、异常通知与运行保障。'],
]
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || '请求未完成，请稍后重试')
  return result as T
}
function Mark({ small = false }: { small?: boolean }) {
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
export function App() {
  const [view, setView] = useState<View>('projects')
  const [projects, setProjects] = useState<Project[]>([])
  const [status, setStatus] = useState<ProductStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Project | null>(null)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const createButton = useRef<HTMLButtonElement>(null)
  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const [data, health] = await Promise.all([
        request<{ items: Project[] }>('/api/projects'),
        request<ProductStatus>('/api/health'),
      ])
      setProjects(data.items)
      setStatus(health)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])
  function closeForm() {
    setShowForm(false)
    setFormError('')
    createButton.current?.focus()
  }
  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const input: CreateProject = {
      name: String(form.get('name')),
      key: String(form.get('key')),
      framework: String(form.get('framework')) as CreateProject['framework'],
      description: String(form.get('description') || ''),
    }
    setSaving(true)
    setFormError('')
    try {
      const { project } = await request<{ project: Project }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      setProjects((current) => [project, ...current])
      setSelected(project)
      setNotice('项目已保存到本机工作空间')
      closeForm()
    } catch (failure) {
      setFormError((failure as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const titles = { projects: '项目空间', channels: '渠道能力', roadmap: '演进路线' }
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            setView('projects')
          }}
        >
          <Mark />
          <span>
            Release
            <br />
            <strong>Harbor</strong>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">L</span>
          <div>
            本地工作空间<small>LOCAL WORKSPACE</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <div className="nav-caption">工作台</div>
        <nav aria-label="工作台导航">
          {(['projects', 'channels', 'roadmap'] as View[]).map((item, index) => (
            <button
              key={item}
              className={view === item ? 'nav-item active' : 'nav-item'}
              aria-current={view === item ? 'page' : undefined}
              onClick={() => {
                setView(item)
                setNotice('')
              }}
            >
              <span className="nav-symbol" aria-hidden="true">
                {['▦', '⇄', '↗'][index]}
              </span>
              {titles[item]}
              {item === 'projects' && <span className="nav-count">{projects.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">ONE PLACE. EVERY RELEASE.</span>
          <p>
            让每一次发布，
            <br />
            都有清晰的航线。
          </p>
          <div className="contour" aria-hidden="true">
            ◡<br />◡<br />◡
          </div>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" />
          本地基础版<span>v0.1</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            工作台 <span>/</span> <strong>{titles[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className="mode-pill">LOCAL</span>
            <span>{status ? '本机服务已连接' : loading ? '正在连接服务' : '服务连接待检查'}</span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                RELEASE HARBOR /{' '}
                {view === 'projects' ? 'PROJECTS' : view === 'channels' ? 'CHANNELS' : 'ROADMAP'}
              </p>
              <h1>
                {view === 'projects'
                  ? '每个应用，都有自己的港口。'
                  : view === 'channels'
                    ? '每个商店，都有清晰的能力边界。'
                    : '从本地工具，走向独立发布产品。'}
              </h1>
              <p className="subtitle">
                {view === 'projects'
                  ? '集中管理不同项目，逐步建立安装包、渠道与发布记录之间的关联。'
                  : view === 'channels'
                    ? '统一查看适配规划，实际发布能力将在真实渠道验收后开放。'
                    : '以可用的工作台为起点，逐期打通交付、审核与在线协作。'}
              </p>
            </div>
            {view === 'projects' && (
              <button
                ref={createButton}
                className="button primary"
                disabled={!status}
                onClick={() => {
                  setShowForm(true)
                  setFormError('')
                  setNotice('')
                }}
              >
                <span aria-hidden="true">＋</span> 新建项目
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => void refresh()}>重新连接</button>
            </div>
          )}
          {notice && (
            <p role="status" className="notice">
              ✓ {notice}
            </p>
          )}
          {view === 'projects' && (
            <>
              <section className="metrics" aria-label="工作空间概况">
                <div>
                  <span>已创建项目</span>
                  <strong>{loading ? '—' : String(projects.length).padStart(2, '0')}</strong>
                  <small>真实保存在本机工作空间</small>
                </div>
                <div>
                  <span>首批渠道规划</span>
                  <strong>02</strong>
                  <small>华为 AppGallery · Apple App Store</small>
                </div>
                <div>
                  <span>当前交付</span>
                  <strong className="metric-text">产品基础骨架</strong>
                  <small>项目管理已开放 · 真实发布待接入</small>
                </div>
              </section>
              {showForm && (
                <section className="form-panel" aria-labelledby="create-title">
                  <div className="section-title">
                    <h2 id="create-title">建立项目空间</h2>
                    <button className="text-button" disabled={saving} onClick={closeForm}>
                      取消
                    </button>
                  </div>
                  <form onSubmit={(event) => void createProject(event)}>
                    <div className="form-grid">
                      <label>
                        项目名称
                        <input
                          name="name"
                          autoFocus
                          required
                          maxLength={60}
                          placeholder="例如：景云销"
                        />
                      </label>
                      <label>
                        项目标识
                        <input
                          name="key"
                          required
                          minLength={2}
                          maxLength={40}
                          pattern="[a-z][a-z0-9-]{1,39}"
                          placeholder="例如：seakoi-app"
                        />
                        <small>小写字母开头，使用字母、数字与短横线</small>
                      </label>
                      <label>
                        技术栈
                        <select name="framework" defaultValue="react-native">
                          {Object.entries(frameworkNames).map(([key, value]) => (
                            <option key={key} value={key}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        项目说明
                        <input
                          name="description"
                          maxLength={300}
                          placeholder="可选，说明应用用途"
                        />
                      </label>
                    </div>
                    {formError && (
                      <p role="alert" className="form-error">
                        {formError}
                      </p>
                    )}
                    <div className="form-bottom">
                      <span>这里只保存项目公开资料，无需商店密码或安装包。</span>
                      <button className="button primary" disabled={saving} type="submit">
                        {saving ? '正在保存…' : '创建项目'}
                      </button>
                    </div>
                  </form>
                </section>
              )}
              <div className="section-title project-title">
                <h2>
                  全部项目 <span>{projects.length}</span>
                </h2>
                <span className="caption">按创建时间排序</span>
              </div>
              {loading ? (
                <div className="empty-state" role="status">
                  正在加载项目…
                </div>
              ) : projects.length === 0 ? (
                <section className="empty-state">
                  <Mark small />
                  <h2>从第一个项目开始</h2>
                  <p>
                    为 React Native、Flutter 或原生应用建立独立项目空间。
                    <br />
                    接下来，安装包、渠道配置与发布计划都将归属于这里。
                  </p>
                  <button
                    className="button secondary"
                    disabled={!status}
                    onClick={() => setShowForm(true)}
                  >
                    创建第一个项目 <span aria-hidden="true">↗</span>
                  </button>
                </section>
              ) : (
                <div className="projects-grid">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      className={'project-card' + (selected?.id === project.id ? ' selected' : '')}
                      onClick={() => setSelected(project)}
                    >
                      <div className="project-card-top">
                        <span className="project-avatar">{project.name.slice(0, 1)}</span>
                        <span className="framework-tag">{frameworkNames[project.framework]}</span>
                      </div>
                      <h3>{project.name}</h3>
                      <code>{project.key}</code>
                      <p>{project.description || '暂未添加项目说明'}</p>
                      <div className="project-card-bottom">
                        <span>项目空间已建立</span>
                        <span aria-hidden="true">↗</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selected && (
                <section className="project-detail" aria-label="项目详情">
                  <div>
                    <span className="eyebrow">SELECTED PROJECT</span>
                    <h2>{selected.name}</h2>
                    <p>{selected.description || '暂未添加项目说明'}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>技术栈</dt>
                      <dd>{frameworkNames[selected.framework]}</dd>
                    </div>
                    <div>
                      <dt>创建时间</dt>
                      <dd>{new Date(selected.createdAt).toLocaleDateString('zh-CN')}</dd>
                    </div>
                    <div>
                      <dt>下一步</dt>
                      <dd>应用与商店绑定 · 待实现</dd>
                    </div>
                  </dl>
                </section>
              )}
            </>
          )}
          {view === 'channels' && (
            <section className="channel-list" aria-label="渠道规划">
              {channelCapabilities.map((channel, index) => (
                <article key={channel.id}>
                  <span className="channel-number">0{index + 1}</span>
                  <div>
                    <h2>{channel.name}</h2>
                    <p>
                      {channel.artifact} · 规划动作：{channel.plannedAction}
                    </p>
                  </div>
                  <span className="planned-tag">待接入</span>
                </article>
              ))}
              <p className="fine-print">
                上游 SDK 的支持范围与产品已实现能力分别管理。当前版本没有上传、送审或上线接口。
              </p>
            </section>
          )}
          {view === 'roadmap' && (
            <section className="roadmap" aria-label="产品路线图">
              {phases.map(([title, description], index) => (
                <article key={title}>
                  <span className="phase-number">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <p className="eyebrow">PHASE {index + 1}</p>
                    <h2>{title}</h2>
                    <p>{description}</p>
                  </div>
                  <span className={index === 0 ? 'current-tag' : 'planned-tag'}>
                    {index === 0 ? '基础骨架已建立' : '规划中'}
                  </span>
                </article>
              ))}
            </section>
          )}
          <footer className="content-footer">
            <span>RELEASE HARBOR</span>
            <p>已有安装包接入 · 框架无关 · 项目独立管理</p>
            <span>FOUNDATION / 0.1</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
