# TODO.md

## Goal
Add Cloudflare Pages deployment as a third deployment option for the OpenCodeUI standalone frontend (alongside Docker standalone and Tauri desktop).

## Scope (this project only)
- Pages Function (proxy `/api/*` to Worker via service binding)
- Worker (forwards to backend through Cloudflare VPC + Tunnel binding)
- GitHub Actions workflow for Worker deployment
- Documentation

## Out of scope (separate project)
- `opencode serve` backend itself
- `cloudflared` tunnel configuration
- Tunnel runner / systemd unit
- Tunnel creation in Cloudflare Dashboard
- VPC Service registration (user does in Cloudflare Dashboard, gets back a service_id)

## Approach
1. Pages Function: forward `/api/*` requests to the Worker via service binding — DONE
   - File: `functions/api/[[path]].ts`
2. Worker: proxy backend through VPC Service binding — DONE
   - Directory: `workers/api-proxy/`
   - `package.json`, `wrangler.toml`, `tsconfig.json`, `src/index.ts`
3. GitHub Actions: auto-deploy Worker on changes to `workers/api-proxy/**` — DONE
   - File: `.github/workflows/deploy-worker.yml`
4. Documentation: standalone Cloudflare Pages deployment guide — DONE
   - File: `docs/cloudflare-pages.md`
5. Update `.gitignore` for Worker subproject — DONE

## Current Step
All implementation complete. Awaiting user to:
- Create tunnel + register VPC Service in Cloudflare
- Fill in `service_id` in `workers/api-proxy/wrangler.toml`
- Push to trigger GitHub Actions Worker deploy
- Create Pages project + service binding
