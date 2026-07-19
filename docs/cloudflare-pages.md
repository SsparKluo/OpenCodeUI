# Cloudflare Pages + Access Deployment

把 OpenCodeUI 作为纯静态 SPA 部署到 Cloudflare Pages，UI 和任意数量的 OpenCode Tunnel 后端由**同一个 Cloudflare Access Application** 统一保护。

适用场景：希望在 Cloudflare 边缘托管前端，多设备（手机/桌面）打开同一个 UI，自由切换不同后端（多个 Tunnel、其他 HTTPS 服务器、当前设备 localhost）。

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Cloudflare 边缘                              │
│                                                                  │
│   ui.example.com  ──┐                                            │
│   api-a.example.com ┼── Access Application (CF_Authorization)     │
│   api-b.example.com ┘        │                                   │
│                              │                                   │
│   ui  → Pages (静态 SPA)                                          │
│   api-* → Tunnel → 用户各自的 opencode serve (127.0.0.1:4096)     │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 浏览器携带每个 hostname 的 CF_Authorization cookie
                              │ SPA 选择 active server，直接发请求
```

- 前端：纯静态，无 Worker、无 Pages Function、无 VPC Service
- API：每个 backend 走自己的 Tunnel hostname
- 鉴权：Cloudflare Access（用户登录）+ 可选的 OpenCode Basic Auth 作为第二层
- 浏览器：fetch / SSE / WebSocket 都使用 `credentials: 'include'`，由 Access cookie 鉴权

## 与旧部署方案的差异

| 维度 | 旧 `deploy/cloudflare-legacy` | 当前 `deploy/cloudflare` |
| --- | --- | --- |
| 前端托管 | Pages | Pages（无 Function） |
| API 代理 | Pages Function → API Proxy Worker → VPC Service → Tunnel | 直接走 Tunnel hostname，无中间层 |
| Workspace | `pnpm-workspace.yaml` + `workers/api-proxy/` | 无 |
| 多后端 | 单一 backend，固定在 Worker 配置 | 浏览器同时支持多个，用户切换 |
| 鉴权 | 单一 OpenCode Basic Auth | Cloudflare Access + 可选 Basic |

## 前端运行时的认证模式

`ServerConfig.authMode`（`src/store/serverStore.ts`）只有两个值：

- `basic`：默认。SDK 使用 `credentials: 'same-origin'`，如果填了用户名密码就注入 `Authorization` header，没填就是无认证。
- `cloudflare-access`：SDK 使用 `credentials: 'include'`，让浏览器自动携带 `CF_Authorization` cookie。如果同时填了用户名密码（在表单里勾选 "Use Cloudflare Access" 的同时点击 "Add authentication" 填写），`Authorization` header 也会照常发送，作为纵深防御。

设计上只有两个模式：是否使用 Cloudflare Access 是一个 boolean 决定（`authMode`），是否使用 Basic 是另一个 boolean 决定（看 `auth?.password` 是否填写），两者独立组合。`getEffectiveAuthMode` 会把历史值（`'none'`、`'cloudflare-access+basic'`）归一化到这两个值。

UI 上沿用 dev 原有的"Add authentication"展开/折叠用户名密码框，下方多一个 **"Use Cloudflare Access"** 复选框。两者可以同时勾选（Access + Basic 纵深防御），也可以只勾一个，或者都不勾（无认证）。

具体在以下位置生效：

- `src/api/sdk.ts` — `trackedFetch` 根据模式选择 `credentials`；`buildHeaders` 只看是否填了密码决定是否注入 `Authorization`；`buildCacheKey` 包含 `authMode`，切换模式会重建 client
- `src/api/events.ts` — SSE 浏览器分支在 access 模式下使用 `credentials: 'include'`
- `src/api/http.ts` — `getAuthHeader` 只看密码；`isActiveAccessMode` 看 authMode 是否 `cloudflare-access`
- `src/api/pty.ts` — PTY WebSocket：只有 access 模式 **且** 未填 Basic 凭据时才不在 URL 嵌入认证；其他情况走原来的 userinfo + auth_token 路径（cookie 同时自动携带）
- `src/store/serverStore.ts` — `checkHealth` 同样按 authMode 决定 credentials，按密码决定 header
- `src/features/settings/components/ServersSettings.tsx` — `EditServerForm` / `AddServerForm` 增加一个 Cloudflare Access 复选框；`ServerItem` 显示 Access 徽标和外链登录按钮

## Dashboard 配置 runbook

> 文中的 `example.com` 替换为你的真实域名。所有 hostname 都必须在同一个 Cloudflare zone 下。

### 1. 创建 Pages 项目

**选项 A（推荐）：Git 集成**

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
2. 选择仓库 `SsparKluo/OpenCodeUI`，分支 `deploy/cloudflare`
3. 构建配置：
   - Framework preset：`Vite`
   - Build command：`npm run build`
   - Build output directory：`dist`
   - Node version：`22`
   - 环境变量（可选）：`VITE_API_BASE_URL` 留空（默认 `http://127.0.0.1:4096`，让 SPA 对所有 backend 中立）
4. 绑定 production branch：`deploy/cloudflare`

如果选 A，可以删除 `.github/workflows/deploy-cloudflare.yml`，不需要 GitHub Action。

**选项 B：GitHub Action**

保留 `.github/workflows/deploy-cloudflare.yml`，并在仓库 Settings → Secrets → Actions 添加：

- `CLOUDFLARE_API_TOKEN`：权限 `Cloudflare Pages: Edit` + `Account: Read`
- `CLOUDFLARE_ACCOUNT_ID`：账户首页右侧

可选 Variables：

- `CF_PAGES_PROJECT_NAME`：默认 `opencodeui`
- `CF_PAGES_VITE_API_BASE_URL`：如果想让 SPA 首次打开就指向某个 backend

### 2. 绑定 UI 自定义域名

Pages 项目 → Custom domains → Add → `ui.example.com`。

要求该 zone 的 nameservers 在 Cloudflare；若使用 apex 域名，按 dashboard 提示配置。

### 3. 创建 Cloudflare Tunnel 并发布 API

为每个 backend 创建一个 Tunnel（或共用同一个 Tunnel 多个 ingress 规则，按你的拓扑决定）。

1. Zero Trust → Networks → Tunnels → Create a tunnel
2. 复制安装命令，在后端机器运行 `cloudflared`
3. 等待连接 Healthy
4. Routes → Add route → Published application：
   - Subdomain：`api-a`
   - Domain：`example.com`
   - Service URL：`http://localhost:4096`
5. 重复为其他 backend 添加 `api-b.example.com` 等。

### 4. 创建 Access Application

Zero Trust → Access controls → Applications → Create new application → Self-hosted and private → Add public hostname。

为每个 hostname 添加条目，**推荐同一个 Application 覆盖全部**（≤5 个域名时 Access 会预先签发各 hostname 的 cookie，体验上一次登录即可）：

- `ui.example.com`
- `api-a.example.com`
- `api-b.example.com`
- `api-c.example.com`

策略建议：

| Action | Rule type | Selector | Value |
| --- | --- | --- | --- |
| Allow | Include | Emails | your-email@example.com |
|        | Require | MFA | (recommended) |

Session Duration：8h ~ 24h 视使用习惯而定。

**避免使用**：

- `Include Everyone`（等于公开）
- `Bypass Everyone`（跳过所有检查且不记录日志）

### 5. Access CORS 设置

Application → Advanced settings → Cross-Origin Resource Sharing (CORS) settings：

- `Access-Control-Allow-Origin`：`https://ui.example.com`
- `Access-Control-Allow-Credentials`：`true`
- `Access-Control-Allow-Methods`：`GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers`：`Authorization, Content-Type, Accept`

或选择 **Bypass OPTIONS requests to origin**，让源站自己严格处理 CORS。

### 6. Tunnel 端开启 Protect with Access（推荐）

每个 published application route → Edit → Additional application settings → Access → Protect with Access: required。

本地管理 Tunnel 的对应配置：

```yaml
ingress:
  - hostname: api-a.example.com
    service: http://127.0.0.1:4096
    originRequest:
      access:
        required: true
        teamName: your-team-name
        audTag:
          - <Access-app-AUD-tag>
  - service: http_status:404
```

最后的 `http_status:404` 兜底很重要，避免未匹配请求落到意外服务。

### 7. opencode serve 启动参数

每个 backend 机器：

```bash
OPENCODE_SERVER_USERNAME=opencode \
OPENCODE_SERVER_PASSWORD='strong-password' \
opencode serve \
  --hostname 127.0.0.1 \
  --port 4096 \
  --cors https://ui.example.com
```

- `--hostname 127.0.0.1`：不监听公网或局域网
- `--cors https://ui.example.com`：允许 SPA 跨域调用
- `OPENCODE_SERVER_PASSWORD`：作为 Access 之后的第二层防线

如果完全依赖 Access、不需要 Basic Auth，可以省略密码并直接：

```bash
opencode serve --hostname 127.0.0.1 --port 4096 --cors https://ui.example.com
```

然后在 SPA 的服务器配置里选择 authMode = `Cloudflare Access`。

### 8. 防火墙（推荐）

源站机器实现 positive security model：

- 删除所有 inbound 规则（除 SSH）
- 只允许 `cloudflared` outbound 到 `*.argotunnel.com:7844`

参考 [Tunnel with firewall](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/)。

详细 IP 列表见官方文档。`cloudflared` 是 outbound-only，不需要开 4096 入站。

### 9. Cache Rules（推荐）

对每个 API hostname 添加 Cache Rule：

- If hostname equals `api-a.example.com`
- Then Cache eligibility = **Bypass cache**

OpenCode API 返回的会话列表、消息、模型列表等都是动态的，绝对不要使用 Cache Everything。

UI hostname (`ui.example.com`) 不需要 Cache Rule：`public/_headers` 已经指定了静态资源缓存策略，Cloudflare Pages 会自动遵守。

### 10. 验证

1. 浏览器打开 `https://ui.example.com`，完成 Access 登录
2. 进入 Settings → Servers
3. Add server：
   - Name：`API-A`
   - URL：`https://api-a.example.com`
   - Authentication：`Cloudflare Access`
4. 保存后点击 server 旁边的**外链图标**（Open this server to complete Cloudflare Access login）—— 在新标签打开 `api-a.example.com`，Access 通常会自动签发 cookie 后立刻重定向到 SPA。如果显示登录页，完成一次登录即可。
5. 关闭新标签，回到 SPA。点击 health check，应显示 online。
6. 切换 active server，发起对话，确认 SSE / WebSocket 正常。

## 桌面端 Tauri 的限制

Tauri 的 `@tauri-apps/plugin-http` fetch 没有 cookie jar，`credentials: 'include'` 不生效。因此：

- Tauri 桌面端只支持 `none` 或 `basic` 模式（典型场景：本地 opencode serve）
- Access 模式的 server 在桌面端 health check 会失败（无 cookie），这是预期行为
- 若必须从桌面端访问 Access 后端，需要在桌面端浏览器/PWA 打开 SPA

## 局部网络访问提示

Chrome 142+ 对公网页面访问 loopback / 局域网会弹出 **Local Network Access** 权限提示。SPA 在用户选择 `http://127.0.0.1:4096` 或局域网 backend 时会触发，用户允许后才能继续。这是浏览器层面的策略，不是 Cloudflare 控制的。

## Troubleshooting

### `node plugin is not installed` / `rust plugin is not installed`

Cloudflare Pages 检测到根目录的 `.tool-versions` 时会尝试用 asdf 安装，但其构建镜像没有 node/rust asdf 插件。`deploy/cloudflare` 已经把 `.tool-versions` 改名为 `.tool-versions.bak` 绕过这个检测。

如果以后 merge `dev` 把 `.tool-versions` 又带回来，需要在 `deploy/cloudflare` 上再次改名。或者直接在 Pages 项目环境变量里设 `NODE_VERSION=22`，部分情况下能跳过 asdf 路径。

### Access cookie 没有携带（请求 403 / 重定向到登录页）

- 确认 Access Application 把 UI 和 API hostname 都列为 public hostname（≤5 个域名才自动预发 cookie）
- 浏览器是否在隐私模式（默认阻止第三方 cookie）
- Access Application 的 SameSite 设置：跨子域场景需要 `None` 或 `Lax`
- 确认 server 的 `authMode` 在 SPA 里是 `Cloudflare Access`，否则 fetch 不会带 `credentials: 'include'`
- 在 server 行点击外链图标，在新标签完成一次登录后再回来

### PTY WebSocket 一直连不上

- Access 保护 WebSocket 的能力依赖浏览器在 WS handshake 时发送 cookie；Chrome/Firefox 没问题，iOS Safari PWA 行为需要实测
- 确认 Cloudflare zone 的 WebSockets toggle 开启（默认开）
- 如果同时启用了 Basic Auth，前端会在 URL 里嵌 `auth_token=base64(user:pass)`，可能出现在日志里。Access server 应该不配 Basic Auth

### 健康检查显示 offline（Tauri 桌面端）

Tauri fetch 没有 cookie jar，Access server 在桌面端不可用。这是预期行为。桌面端继续使用 local server（Basic 或无认证）。

## 本地开发

```bash
npm run dev
# Vite proxy 把 /api/* 转发到 http://127.0.0.1:4096（见 vite.config.ts）
```

本地不需要 Cloudflare Pages 或 Access。所有 server 配置改动可以正常用 `localStorage` 测试。

## 迁移步骤（从旧 `deploy/cloudflare-legacy`）

1. 在 Cloudflare 删除旧的 Pages 项目（Functions + Worker 绑定）
2. 删除旧的 API Proxy Worker：`opencode-api-proxy`
3. 删除 VPC Service：`opencode-backend`
4. 按 dashboard runbook 重新创建（无 Worker、无 Function）
5. Tunnel 可以复用，published application 路由保持不变

旧 Worker 的 API GET 缓存逻辑（`Cache API` + `KV` 二级缓存）**不要迁移**。OpenCode API 的响应语义并不适合边缘缓存。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `public/_redirects` | SPA fallback：`/* /index.html 200` |
| `public/_headers` | 静态资源缓存策略 |
| `.github/workflows/deploy-cloudflare.yml` | 可选的 Pages 部署 workflow |
| `src/store/serverStore.ts` | `authMode` 类型、`getEffectiveAuthMode`、health check |
| `src/api/sdk.ts` | SDK fetch 根据 authMode 决定 credentials 和 Authorization header |
| `src/api/events.ts` | SSE 浏览器路径使用 `credentials: 'include'`（access 模式） |
| `src/api/pty.ts` | PTY WebSocket 在 access 模式下不在 URL 嵌入凭据 |
| `src/api/http.ts` | `getAuthHeader` / `isActiveAccessMode` |
| `src/features/settings/components/ServersSettings.tsx` | authMode 选择器、Access 登录按钮、Access 徽标 |
