export type HtmlColorScheme = 'light' | 'dark'

export const HTML_SANDBOX_SECURITY_HEAD = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; img-src https: http: data: blob:; media-src https: http: data: blob:; font-src https: http: data:; style-src 'unsafe-inline' https: http:; script-src 'unsafe-inline' 'unsafe-eval' https: http: blob:; connect-src https: http:">`

export function createSandboxedHtmlDocument(
  source: string,
  resizeId: string,
  theme: HtmlColorScheme,
  options: { overflow?: 'auto' | 'hidden'; allowDataScripts?: boolean } = {},
): string {
  const overflow = options.overflow ?? 'hidden'
  const securityHead = options.allowDataScripts
    ? HTML_SANDBOX_SECURITY_HEAD.replace('http: blob:', 'http: blob: data:')
    : HTML_SANDBOX_SECURITY_HEAD
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const themeHead = `<style id="opencode-html-theme">:root{color-scheme:${theme};font-family:system-ui,sans-serif}html,body{margin:0;overflow:${overflow};background:transparent;color:${theme === 'dark' ? '#d8d8d8' : '#2b2b2b'}}</style>`
  parsed.head.insertAdjacentHTML('afterbegin', `${securityHead}${themeHead}`)
  const themeScript = `<script>(()=>{const apply=theme=>{document.documentElement.style.colorScheme=theme;document.documentElement.dataset.theme=theme;const style=document.getElementById('opencode-html-theme');if(style)style.textContent=':root{color-scheme:'+theme+';font-family:system-ui,sans-serif}html,body{margin:0;overflow:${overflow};background:transparent;color:'+(theme==='dark'?'#d8d8d8':'#2b2b2b')+'}';dispatchEvent(new CustomEvent('opencode-theme-change',{detail:{theme}}));dispatchEvent(new Event('resize'))};addEventListener('message',event=>{if(event.data?.type==='opencode-html-theme')apply(event.data.theme)})})()</script>`
  const resizeScript = `<script>(()=>{const id=${JSON.stringify(resizeId)};const send=()=>{const body=document.body;const height=Math.max(120,Math.ceil(body.scrollHeight),Math.ceil(body.getBoundingClientRect().height));parent.postMessage({type:'opencode-html-resize',id,height},'*')};addEventListener('load',send);if(typeof ResizeObserver!=='undefined')new ResizeObserver(send).observe(document.body);requestAnimationFrame(send)})()</script>`
  parsed.body.insertAdjacentHTML('afterbegin', `${themeScript}${resizeScript}`)
  return `<!doctype html>${parsed.documentElement.outerHTML}`
}
