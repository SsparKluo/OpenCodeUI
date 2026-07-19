# Fork 定制记录

> 本文档记录本 fork（`SsparKluo/OpenCodeUI`，作者 Louis LUO `<ssparkluo@gmail.com>`）相对于上游 `lehhair/OpenCodeUI` 的全部定制改动，**目的是在未来 merge upstream 时作为参考**：知道改了什么、为什么改、改了哪些文件，从而预判冲突、避免回退、快速重应用。

最后核对基准：上游 `main` = `6d10da9`（v0.6.24），fork 集成分支 `dev` = `c7527af`。

---

## 1. 分支模型

| 分支            | 角色                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `upstream/main` | 上游 `lehhair/OpenCodeUI` 主干                                       |
| `main`          | **纯上游镜像**，始终与 `upstream/main` 对齐（`merge-base` 相同）     |
| `dev`           | **fork 集成分支**，所有 Louis 的定制都在这里；下游功能分支从此拉出   |
| `feat/*`、`fix/*`| 主题功能分支，完成后合并回 `dev`                                     |
| `deploy/cloudflare` | Cloudflare 部署分支（当前）：基于 `dev`，纯静态 Pages + 多后端 Access |
| `deploy/cloudflare-legacy` | 旧的 Pages Function + API Proxy Worker + VPC 部署方案（保留作参考） |

**合并 upstream 的标准流程**：`git fetch upstream` → 在 `dev` 上 `git merge upstream/main` → 参考**第 3 节**逐个冲突点核对意图 → 解决冲突后跑 `pnpm test`。`main` 分支仅用于 fast-forward 到 `upstream/main`，**不要在 main 上做任何 fork 改动**。

---

## 2. 定制概览（按主题）

fork 共有约 50 个非合并提交，归为 10 个主题。下表按「上游冲突风险」排序——风险越高，merge upstream 时越需要重点关注。

| # | 主题                       | 类型      | 冲突风险 | 主要文件                                        |
| - | -------------------------- | --------- | -------- | ----------------------------------------------- |
| 1 | 滚动系统重构               | 重写      | 🔴 高    | `useAutoScroll.ts`、`ChatArea.tsx`              |
| 2 | 移动端输入框折叠           | 重写      | 🔴 高    | `InputBox.tsx`、`useMobileCollapse.ts`          |
| 3 | 侧边栏 / 项目选择器重构    | 重写      | 🔴 高    | `SidePanel.tsx`、`Header.tsx`、`useSessions.ts` |
| 4 | 模型选择器移到输入栏       | UI 迁移   | 🟡 中    | `Header.tsx`、`InputToolbar.tsx`、`ModelSelector.tsx` |
| 5 | per-block 自动展开控制     | 功能+设置 | 🟡 中    | `MessageRenderer.tsx`、各 PartView、`themeStore.ts` |
| 6 | 触摸手势 / iOS Safari      | 平台修复  | 🟡 中    | `ChatArea.tsx`、`scrollGesture.ts`、`index.css` |
| 7 | Diff / 代码预览复制按钮    | 功能      | 🟡 中    | `DiffViewer.tsx`、`CodePreview.tsx`、`diffFormat.ts` |
| 8 | API 错误处理 / 鉴权        | 健壮性    | 🟢 低    | `sdk.ts`、`errorHandling.ts`、`ServersSettings.tsx` |
| 9 | aggregateStepFinish 选项   | 功能+设置 | 🟢 低    | `MessageRenderer.tsx`、`ChatSettings.tsx`       |
| 10 | Cloudflare 部署           | 部署专属  | 🟢 低    | `workers/api-proxy/`、`.github/workflows/`      |

---

## 3. 主题详解

### 3.1 滚动系统重构 🔴

**目的**：上游的聊天滚动实现存在抖动、跟随不可靠、加载新内容时跳屏等问题。fork 用 `@tanstack/react-virtual` 虚拟化聊天页面，配合自研的 `useAutoScroll` hook 重建整个滚动系统，实现：稳定跟随、阈值内回弹到底、内容增长时智能保持位置。

**关键设计**：
- 聊天页面按 `chatPageModel.ts` 分页，**倒序存储、正序渲染**（最旧页面在顶部）。
- `useAutoScroll` 维护「跟随模式」，用户向上滚动超出阈值即脱离跟随，回弹到阈值内自动重新跟随。
- 用 opencode 的 `markBoundaryGesture` 替代原本 250ms 时间窗来识别滚动手势边界（更准确）。
- 「智能滚动」阈值统一为 60px（`0c729b0`），子代理 Task 视图、胶囊推理块各自适配。

**涉及文件**：
- `src/hooks/useAutoScroll.ts`（+ `.test.ts`）— 核心实现，**几乎全量重写**
- `src/features/chat/ChatArea.tsx` — 虚拟化容器
- `src/features/chat/chatPageModel.ts` + `ChatArea.test.ts` — 页面模型
- `src/features/chat/ChatPane.tsx`
- `src/features/chat/scrollGesture.ts` + `useScrollGestureDetector.ts`（+ tests）— 手势识别
- `src/features/message/parts/ReasoningPartView.tsx`、`src/features/message/tools/renderers/TaskRenderer.tsx` — 智能滚动适配

**关键 commits**（按 dev 上的最新版本；部分有 rebase 双胞胎已省略）：
- `f3b5c6a` feat: overhaul scroll system with useAutoScroll + @tanstack/react-virtual
- `85cd3c7` fix: reverse chat page order so oldest messages render first
- `8563b37` fix: auto-scroll to bottom when last page expands
- `4cc782e` fix: auto-snap to bottom when user scrolls within threshold
- `b4e62b8` fix: debounce snap timer and use instant scroll
- `1c5c18c` refactor: replace 250ms scroll gesture window with markBoundaryGesture
- `0c729b0` fix: unify smart scroll threshold to 60px
- `d326eb3` fix: smart scroll for subagent task view
- `0a49bd6` fix: smart scroll for capsule reasoning block
- `95fe6e9` fix(chat): eliminate auto-scroll jitter when scrolling up slowly near bottom
- `fce3f67`→`fb8c163`（已 revert）尝试在容器 resize 时 re-snap，最终放弃

> ⚠️ **上游冲突高发区**。上游对 `ChatArea` / 滚动逻辑改动频繁，每次 merge 几乎必然冲突。核对意图时优先保证 `useAutoScroll` 的「跟随/脱离/回弹」语义不被破坏。

---

### 3.2 移动端输入框折叠 🔴

**目的**：移动端输入框展开/收起原本用 auto-collapse，体验割裂。fork 改为**手动折叠 + CSS `grid-rows` 过渡**，并把 textarea 高度测量从直接读 DOM 改为**隐藏 mirror 元素**测量，避免输入时布局抖动和页脚被顶出可视区。

**关键设计**：
- `InputBox.tsx` 用 CSS grid 双行轨道（展开行 / 折叠行）做过渡，折叠时**完全回收**空间（不留 gap — `587f580`）。
- textarea 高度由 `measureTextareaContentHeight.ts` 隐藏 mirror 测量，`useTextareaAutoHeight.ts` 消费；不再在 auto-resize 时重置高度（`e9bff81`）。
- Mention/SlashCommand 菜单移出 `overflow-hidden` 容器，防止被裁切（`46a079d`）。

**涉及文件**：
- `src/features/chat/InputBox.tsx` — **重灾区**，几乎每次 merge 都冲突
- `src/features/chat/input/useMobileCollapse.ts`
- `src/features/chat/input/useTextareaAutoHeight.ts`
- `src/features/chat/input/measureTextareaContentHeight.ts`（新增）
- `src/features/chat/input/InputActions.tsx`、`InputToolbar.tsx`
- `src/constants/ui.ts`

**关键 commits**：
- `d89d815` refactor: mobile input collapse bar with CSS grid-rows transition
- `a28cac2` refactor: replace auto-collapse with manual collapse toggle on mobile
- `55c41ca` fix: restructure expanded track grid so collapse fully reclaims space
- `c5b3601` fix: use textarea mirror for stable height measurement
- `92fbf69` fix: use hidden mirror element to measure textarea content height
- `e9bff81` fix: remove unnecessary textarea height reset on auto-resize
- `587f580` fix: remove collapsed input track gap over chat history
- `b2b8776` fix: drop expandedHeight reference
- `46a079d` fix: move MentionMenu/SlashCommandMenu outside overflow-hidden

---

### 3.3 侧边栏 / 项目选择器重构 🔴

**目的**：重做侧边栏顶部交互——用「添加项目」按钮替换原项目选择器，并新增**工作区 header location**（会话头部显示/切换所属工作区目录）。同时让 Sidebar 始终挂载，修复折叠/展开过渡丢失的问题。

**关键设计**：
- `SidePanel.tsx` 顶部改为「Open Project」按钮 + 工作区列表。
- 新增 `SessionHeaderLocation.tsx` / `SessionHeaderLocationPicker.tsx` / `sessionHeaderContext.ts`，把工作区目录绑定到会话 header。
- 新增 `useRecentWorkspaceDirectories.ts`、`useSwitchWorkspaceDirectory.ts`、`recentWorkspaceDirectories.ts`、`draftNewChatSession.ts` 等工具。
- `Sidebar.tsx` 始终挂载（`7f16c55`），靠 CSS 控制可见性，保证过渡动画。

**涉及文件**：
- `src/features/chat/sidebar/SidePanel.tsx`、`FolderRecentList.tsx`
- `src/features/chat/Header.tsx`、`PaneHeader.tsx`
- `src/features/chat/SessionHeaderLocation.tsx`、`SessionHeaderLocationPicker.tsx`、`sessionHeaderContext.ts`（新增）
- `src/features/chat/sidebar/{draftNewChatSession,recentWorkspaceDirectories}.ts`（新增）
- `src/features/chat/{useRecentWorkspaceDirectories,useSwitchWorkspaceDirectory}.ts`（新增）
- `src/features/sessions/SessionList.tsx`、`src/hooks/useSessions.ts`
- `src/features/chat/{Sidebar.tsx,ChatPane.tsx,InputBox.tsx}`、`src/App.tsx`

**关键 commits**：
- `261e7b4` refactor: replace project selector with add-project button, add workspace header location
- `c7527af` feat: rename 'add project' to 'open project' and always show new chat in sidebar
- `7f16c55` fix: restore sidebar collapse/expand transition by always mounting Sidebar
- `50c7876` fix: clean up merge fallout — 上次 merge upstream 后的清理性修复

---

### 3.4 模型选择器移到输入栏 🟡

**目的**：把模型选择器从顶部 Header 移到输入框工具栏，让用户在输入时即可切换模型，释放 Header 空间。

**涉及文件**：
- `src/features/chat/Header.tsx` — 移除 ModelSelector
- `src/features/chat/input/InputToolbar.tsx` — 接入 ModelSelector
- `src/features/chat/ModelSelector.tsx`
- `src/features/chat/ChatPane.tsx`

**关键 commits**：
- `15f3ed2` feat: move model selector from header to input toolbar

> 上游若调整 Header 或 InputToolbar 布局会冲突；语义上很简单，冲突时保留「ModelSelector 在 InputToolbar」即可。

---

### 3.5 per-block 自动展开控制 🟡

**目的**：给 reasoning / subtask / tool 等消息块增加**逐块自动展开控制**，并新增「沉浸式未读工具折叠」模式——活跃工具运行期间，未读的工具块按用户偏好折叠，避免刷屏。

**关键设计**：
- 新增 `utils/blockCollapseMode.ts`（+ test）定义折叠模式枚举。
- 设置项写入 `themeStore.ts`，UI 在 `ChatSettings.tsx`。
- 各 `PartView` 根据 mode + 「是否活跃运行」决定展开/折叠。

**涉及文件**：
- `src/features/message/MessageRenderer.tsx`
- `src/features/message/parts/{ReasoningPartView,SubtaskPartView,ToolPartView}.tsx`
- `src/utils/blockCollapseMode.ts`（新增）+ `.test.ts`
- `src/features/settings/components/ChatSettings.tsx`
- `src/store/themeStore.ts`

**关键 commits**：
- `a589062` feat: per-block auto-expand control with immersive unread tool option
- `1c455ca` fix: respect immersive unread tool collapse mode during active tool run

---

### 3.6 触摸手势 / iOS Safari 🟡

**目的**：移动端在 `ChatArea` 上需要同时支持**水平翻页（pager）手势**和**纵向滚动**，但 iOS Safari 默认 `touch-action` 会拦截斜向手势。fork 通过 `touch-pan-y` + 沿 DOM 链向上传播，让 pager 与滚动共存。（曾尝试给 popup 开启垂直 touch pan，最终 revert——iOS 上副作用大于收益。）

**涉及文件**：
- `src/features/chat/ChatArea.tsx`、`ChatPane.tsx`
- `src/features/chat/scrollGesture.ts`、`useScrollGestureDetector.ts`（+ tests）
- `src/index.css` — `touch-action` 相关规则

**关键 commits**：
- `9a33b19` fix: add touch-pan-y to ChatArea to allow horizontal pager gestures on mobile
- `fa3c13c` fix: propagate touch-pan-y up the DOM chain to enable horizontal pager gestures
- `e0e4397`→`41d9ec7`（已 revert）尝试给 iOS Safari popup 开启垂直 touch pan

---

### 3.7 Diff / 代码预览复制按钮 🟡

**目的**：给 diff viewer 和 code preview 加复制按钮，提升可用性。`diffFormat.ts` 抽取统一的 diff 文本格式化逻辑。

**涉及文件**：
- `src/components/DiffViewer.tsx`（+ `.test.tsx`）、`DiffView.tsx`
- `src/components/CodePreview.tsx`（+ `.test.tsx`）
- `src/components/ContentBlock.tsx`、`SessionChangesPanel.tsx`
- `src/features/message/tools/renderers/DefaultRenderer.tsx`
- `src/utils/diffFormat.ts`（+ `.test.ts`）

**关键 commits**：
- `69892a4` feat: add copy button to diff viewer and code preview
- `c30ded2` fix: close JSX expression in CopyButton conditional render（构建修复）

---

### 3.8 API 错误处理 / 鉴权 🟢

**目的**：上游对 opencode server 错误静默失败，fork 把错误**通过 toast 显式暴露给用户**；并支持**在默认 server 上配置鉴权凭据**（原本只能对自定义 server 配）；**允许在存在其他 server 时删除默认 server**（桌面端除外——桌面端的默认 server 既是配置项也是 app 后端）。

**关键设计**（默认 server 可删除）：
- `serverStore.removeServer` 守卫由 `server.isDefault` 改为 `server.isDefault && (isTauri() || servers.length <= 1)`。
- 桌面端（`isTauri()`）禁止删除默认 server——避免 `ServiceSettings` 的「启动本地服务」功能静默失效（`setLocalServerRuntimeUrl` 依赖默认 server 存在）。
- UI 上删除按钮对默认 server 在 `!isTauri() && servers.length > 1` 时显示；编辑按钮仍隐藏（保持作用域最小）。
- 持久化无改动——`loadFromStorage` 的「空列表重建默认」逻辑是安全的，因为删除默认 server 必导致列表非空。唯一能清空列表的路径（删完所有 server）会触发重建默认，这是合理的 reset 行为。

**涉及文件**：
- `src/api/sdk.ts`、`src/utils/errorHandling.ts`（新增）
- `src/contexts/SessionContext.tsx`、`src/hooks/useSessions.ts`
- `src/features/chat/sidebar/{FolderRecentList,SidePanel}.tsx`（错误展示接入点）
- `src/features/settings/components/ServersSettings.tsx`（+ `.test.tsx`）
- `src/store/serverStore.ts`（+ `.test.ts`）— 删除守卫

**关键 commits**：
- `ad838c6` fix: surface opencode server errors to users via toast
- `edd8f49` fix: allow configuring auth credentials on the default server
- （pending）feat: allow deleting the default server when others exist (non-desktop)

---

### 3.9 aggregateStepFinish 选项 🟢

**目的**：新增设置项控制 step-finish 事件的展示方式（聚合显示），写入 `themeStore`。

**涉及文件**：
- `src/features/message/MessageRenderer.tsx`（+ `.test.tsx`）
- `src/features/settings/components/ChatSettings.tsx`
- `src/store/themeStore.ts`

**关键 commits**：
- `9fc58a6` feat: add aggregateStepFinish option for step-finish display

---

### 3.10 Cloudflare 部署 🟢

**目的**：fork 专属的 Cloudflare Pages 静态部署 + 一个 Access Application 同时保护 UI 和多个 Tunnel 后端。上游无此部分，**理论上不会与上游冲突**（文件隔离）。

**关键设计**：

- 纯静态 Pages，无 Pages Function、无 API Proxy Worker、无 Workers VPC Service。
- 浏览器直连用户选中的 backend（Tunnel hostname / 局域网 / localhost），前端不绑定某个固定后端。
- `ServerConfig.authMode: 'basic' | 'cloudflare-access'`（`src/store/serverStore.ts`），仅两个值。
  - Basic 凭据是否发送由 `auth?.password` 是否填写决定，与 `authMode` 正交。
  - `cloudflare-access` 模式下 SDK/SSE/health/PTY 使用 `credentials: 'include'`，让浏览器携带 `CF_Authorization` cookie；同时填了 Basic 凭据就额外注入 `Authorization`（纵深防御）。
  - 历史值（`'none'`、`'cloudflare-access+basic'`）在 `normalizeServerBackup` 里归一化，已有 server 列表不需要手动迁移。
- UI 沿用 dev 原本的 "Add authentication" 展开/折叠用户名密码框，下方多一个 **Use Cloudflare Access** 复选框；`ServerItem` 显示 Access 徽标和外链登录按钮。
- 前端用 Pages Git 集成或 `.github/workflows/deploy-cloudflare.yml` 部署，无 pnpm workspace 子包。
- 完整 runbook 见 `docs/cloudflare-pages.md`。

**涉及文件**：

- `public/_redirects`、`public/_headers`（Pages 静态文件配置）
- `.github/workflows/deploy-cloudflare.yml`（可选的部署 workflow）
- `docs/cloudflare-pages.md`（runbook）
- `src/store/serverStore.ts`（`AuthMode`、`getEffectiveAuthMode`、Access-aware health check）
- `src/store/index.ts`、`src/hooks/useServerStore.ts`（导出新类型/方法）
- `src/api/sdk.ts`（`trackedFetch` credentials、`buildHeaders`）
- `src/api/http.ts`（`getAuthHeader`、`isActiveAccessMode`）
- `src/api/events.ts`（SSE 浏览器路径）
- `src/api/pty.ts`（PTY WebSocket 不在 Access 模式嵌入凭据）
- `src/features/settings/components/ServersSettings.tsx`（authMode 选择器、Access 登录按钮、Access 徽标）
- `src/locales/{en,zh-CN}/settings.json`

**关键 commits**（deploy/cloudflare 重建后的新 commit；下方历史 commits 在 `deploy/cloudflare-legacy` 上保留作参考）：

- feat(cloudflare): rebuild Pages-only deployment with multi-server Cloudflare Access support
- feat(servers): add `cloudflare-access` auth mode with credentials-aware SDK/SSE/PTY/health

**历史 commits**（来自旧的 `deploy/cloudflare`，现已在 `deploy/cloudflare-legacy` 分支上保留）：

- `be41fe7` feat(cloudflare): optimize Pages deployment with `_routes.json`
- `356d8d5` fix(ci): repair deploy-worker pnpm cache on non-monorepo root
- `6cba3ad` fix(ci): use `pnpm --ignore-workspace` for isolated api-proxy
- `58f57ac` fix(worker): explicitly forward request headers via standard RequestInit
- `891a21d` docs(cloudflare): `pnpm install --ignore-workspace` for local api-proxy
- `040921a` feat: add Cloudflare Pages standalone deployment with Worker VPC proxy

旧方案的 Pages Function → API Proxy Worker → VPC Service → Tunnel 两层代理链路已废弃；旧 Worker 的 API GET 边缘缓存逻辑不应迁移，OpenCode API 的响应语义不适合边缘缓存。

---

## 4. 上游合并备忘

### 4.1 必然冲突的「热线」文件

以下文件被多个主题反复修改，且上游也频繁改动，merge 时几乎必冲突：

- `src/features/chat/ChatArea.tsx`（滚动 + 触摸）
- `src/features/chat/InputBox.tsx`（移动端折叠）
- `src/features/chat/Header.tsx`（侧边栏 + 模型选择器）
- `src/features/chat/ChatPane.tsx`（多个主题接入）
- `src/features/message/MessageRenderer.tsx`（per-block + aggregateStepFinish）
- `src/hooks/useAutoScroll.ts`（滚动核心，几乎全量重写）

### 4.2 合并后自检清单

1. `npm install`（确认无 pnpm-lock.yaml；package-lock.json 是唯一 lockfile）
2. `npm test`（重点看 `useAutoScroll`、`blockCollapseMode`、`diffFormat`、`chatPageModel`、`serverStore` 相关测试）
3. 移动端实测：输入框折叠/展开过渡、水平翻页手势、textarea 高度跟随
4. 桌面端实测：模型选择器在输入栏、侧边栏「Open Project」、会话 header 工作区切换
5. 滚动实测：跟随/脱离/回弹、新内容增长时位置保持
6. Cloudflare 部署链路（若 `deploy/cloudflare` 分支要发布）：`npm run build` 在 `deploy/cloudflare` 上跑通；Push 后 GitHub Action 或 Pages Git 集成应产出 SPA；Dashboard 端的 Access Application、Tunnel、Cache Rule 按 `docs/cloudflare-pages.md` 配置

### 4.3 维护本文档

每次 merge upstream 或新增 fork 主题后，**同步更新第 2、3 节**：新增主题补进概览表，已有主题追加 commits 和文件。保持「每个定制都有目的 + 文件 + commit」三元组，未来任何一次 merge 都能快速还原意图。
