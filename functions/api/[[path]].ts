// OpenCodeUI Cloudflare Pages Function
// 转发 /api/* 请求到 API_PROXY Worker（通过 service binding）
//
// 配置：在 Cloudflare Dashboard → Pages → Settings → Functions → Service bindings
//   Variable name: API_PROXY
//   Service:       opencode-api-proxy
//
// 对应后端通过 Worker 的 VPC + Tunnel binding 访问（见 docs/cloudflare-pages.md）

export const onRequest = async (context) => {
  const { request, env } = context

  if (!env.API_PROXY) {
    return new Response(
      'API_PROXY service binding is not configured. ' +
        'Add a service binding named "API_PROXY" pointing to the opencode-api-proxy Worker in the Pages project settings.',
      { status: 500 },
    )
  }

  return env.API_PROXY.fetch(request)
}
