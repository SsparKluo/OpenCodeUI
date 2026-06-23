# Standalone Deployment on Cloudflare Pages

把 OpenCodeUI 前端作为 standalone 部署到 Cloudflare Pages（前端 + API 代理，不带后端）。

## 适用场景

已有 `opencode serve` 运行在私网/本地，希望把前端 UI 部署到 Cloudflare Pages，全球访问。
后端完全不出公网，通过 Cloudflare Tunnel 暴露给 Worker。

## 架构

```
浏览器
  ↓
Cloudflare Pages（前端静态资源 + Pages Function）
  ↓ /api/* via service binding
API Proxy Worker (opencode-api-proxy)
  ↓ VPC Service binding
Cloudflare Tunnel (opencode-backend)
  ↓
私网 / 本地的 opencode serve
```

## 项目边界

| 本项目 | 另一个项目（后端） |
|---|---|
| 前端构建产物 | `opencode serve` 二进制 |
| `functions/api/[[path]].ts`（Pages Function） | `cloudflared` 启动方式（systemd / docker） |
| `workers/api-proxy/`（Worker） | 后端进程管理 |
| Pages + Worker 部署流程 | |

## 一次性配置（在 Cloudflare Dashboard / 另一台后端机器）

### 1. 创建 Tunnel（在后端机器上）

```bash
cloudflared tunnel login
cloudflared tunnel create opencode-backend
```

启动（生产建议 systemd / launchd）：

```bash
cloudflared tunnel run opencode-backend
```

记下 tunnel ID（Dashboard → Zero Trust → Networks → Tunnels 可见）。

### 2. 注册 VPC Service

VPC Service 是"指向某个 tunnel 上具体服务的命名实体"。Worker 绑定的是 service，不是 tunnel。

**Dashboard 方式**：Workers & Pages → **Workers VPC** → **VPC Services** → **Create**：
- Service name：`opencode-backend`
- Tunnel：选 `opencode-backend`
- Host or IP：`localhost`（或后端实际地址，如 `192.168.1.100`）
- HTTP port：`4096`
- HTTPS port：留空

**Wrangler 方式**：

```bash
npx wrangler vpc service create opencode-backend \
  --type http \
  --tunnel-id <TUNNEL_ID> \
  --hostname localhost \
  --http-port 4096
```

记下命令输出的 **Service ID**（UUID 格式）。

### 3. 把 Service ID 填到 Worker 配置

```bash
# workers/api-proxy/wrangler.toml
[[vpc_services]]
binding = "BACKEND_VPC"
service_id = "<SERVICE_ID>"   # 替换为上一步的 UUID
remote = true
```

### 4. 部署 Worker

**A. 手动**

```bash
cd workers/api-proxy
pnpm install
pnpm wrangler deploy
```

**B. GitHub Actions 自动**

仓库 Settings → Secrets 添加：
- `CLOUDFLARE_API_TOKEN`：需要 `Workers Scripts:Edit` + `Workers VPC Services:Bind` + `Account Settings:Read` 权限
- `CLOUDFLARE_ACCOUNT_ID`：账户首页右侧

> `Workers VPC Services:Bind` 是绑定 VPC Service 到 Worker 必需的权限（不是 Read）。Token 权限不够会报 `[code: 10196] credentials are not authorized for the requested VPC resource`。

推送到 `main` 分支且 `workers/api-proxy/**` 有变更时自动部署（见 `.github/workflows/deploy-worker.yml`）。

### 5. 创建 Pages 项目

Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**：

| 字段 | 填写 |
|---|---|
| Repository | `OpenCodeUI` |
| Branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | `VITE_API_BASE_URL` = `/api` |

> 如果需要部署在子路径，加 `VITE_BASE_PATH=/OpenCodeUI/`。

### 6. 绑定 Pages → Worker

Pages 项目 → **Settings** → **Functions** → **Service bindings** → **Add binding**：

| 字段 | 填写 |
|---|---|
| Variable name | `API_PROXY` |
| Service | `opencode-api-proxy` |

### 7. 验证

```bash
curl https://<your-pages>.pages.dev/api/health
```

应该返回后端 `opencode serve` 的响应。

## 本地开发

后端机器上 tunnel 持续运行（步骤 1）。

前端项目（在本仓库）正常开发：

```bash
npm run dev
# 浏览器请求 /api/* 由 Vite dev server 的 proxy 转发到 http://127.0.0.1:4096
# （见 vite.config.ts 的 server.proxy）
```

如果想本地测试 Worker 代理（`wrangler.toml` 的 `remote = true` 启用）：

```bash
cd workers/api-proxy
pnpm install
pnpm dev
# 启动本地 worker，可直接 curl http://localhost:8787/api/health
```

## 工作原理

| 层 | 文件 / 服务 | 职责 |
|---|---|---|
| 静态资源 | `dist/`（Vite build） | 浏览器加载 SPA |
| Pages Function | `functions/api/[[path]].ts` | 接收 `/api/*`，转发到 Worker（service binding，无公网） |
| API Proxy Worker | `workers/api-proxy/src/index.ts` | strip `/api` 前缀，调 `BACKEND_VPC.fetch()` |
| VPC Service | Cloudflare 注册 | 指向 tunnel + 目标 host/port |
| Tunnel | `cloudflared` | 把请求路由到私网后端 |

## 对比 Docker Standalone

| | Docker Standalone | Cloudflare Pages Standalone |
|---|---|---|
| 静态资源 | Caddy | Pages 原生 |
| API 代理 | Caddy `reverse_proxy` | Pages Function → Worker → VPC |
| 后端暴露 | `host.docker.internal`（仅本机） | 私网 + Tunnel（任意位置） |
| 鉴权 | 容器内 HTTP Basic（`OPENCODE_SERVER_PASSWORD`） | 透传到后端，依赖后端配置 |
| 适用 | 单机本地 | 全球 CDN + 私网后端 |
