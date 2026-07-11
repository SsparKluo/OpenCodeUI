export type HtmlColorScheme = 'light' | 'dark'

export const HTML_SANDBOX_SECURITY_HEAD = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; img-src https: http: data: blob:; media-src https: http: data: blob:; font-src https: http: data:; style-src 'unsafe-inline' https: http:; script-src 'unsafe-inline' 'unsafe-eval' https: http: blob:; connect-src https: http:">`
export const HTML_SANDBOX_VIEWPORT_HEAD = '<meta name="viewport" content="width=device-width, initial-scale=1">'

function scrollbarCss(theme: HtmlColorScheme): string {
  const thumb = theme === 'dark' ? 'rgba(210,210,210,.35)' : 'rgba(100,100,100,.35)'
  const thumbHover = theme === 'dark' ? 'rgba(210,210,210,.6)' : 'rgba(100,100,100,.6)'
  return `*{scrollbar-width:thin;scrollbar-color:${thumb} transparent}*::-webkit-scrollbar{width:12px;height:12px;background:transparent}*::-webkit-scrollbar-button{display:none;width:0;height:0}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background-color:${thumb};background-clip:content-box;border:4px solid transparent;border-radius:9999px}*::-webkit-scrollbar-thumb:hover{background-color:${thumbHover}}`
}

export function buildHtmlSandboxThemeCss(theme: HtmlColorScheme, overflow: 'auto' | 'hidden' = 'hidden'): string {
  const textColor = theme === 'dark' ? '#d8d8d8' : '#2b2b2b'
  const root = `:root{color-scheme:${theme};font-family:system-ui,sans-serif}`
  if (overflow === 'auto') {
    // File preview: pin the document to the iframe viewport so body is the scrollport.
    return `${root}html{height:100%;width:100%;margin:0;overflow:hidden}body{height:100%;width:100%;margin:0;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;overscroll-behavior:contain;background:transparent;color:${textColor}}${scrollbarCss(theme)}`
  }
  // Message-stream preview: no internal scroll; parent document scrolls like CM6 tool results.
  return `${root}html,body{margin:0;overflow:hidden;background:transparent;color:${textColor}}`
}

/**
 * Shared content-size probe for sandbox previews.
 * Walks visible rendered boxes instead of documentElement scroll metrics so
 * auto-sized hosts can shrink after the iframe has already grown.
 */
export function createHtmlSandboxMeasureScript(resizeId: string): string {
  return `<script>(()=>{const id=${JSON.stringify(resizeId)};const send=()=>{const body=document.body;if(!body)return;const root=body.getBoundingClientRect();let bottom=0;let right=0;const nodes=body.querySelectorAll('*');for(let i=0;i<nodes.length;i+=1){const el=nodes[i];const tag=el.tagName;if(tag==='SCRIPT'||tag==='STYLE'||tag==='LINK'||tag==='META')continue;const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||style.position==='fixed')continue;const rect=el.getBoundingClientRect();bottom=Math.max(bottom,rect.bottom-root.top);right=Math.max(right,rect.right-root.left)}const height=Math.max(120,Math.ceil(bottom||body.scrollHeight));const width=Math.max(1,Math.ceil(right||body.scrollWidth));parent.postMessage({type:'opencode-html-resize',id,height,width},'*')};addEventListener('pointerdown',()=>parent.postMessage({type:'opencode-html-interaction',id},'*'),true);addEventListener('opencode-html-measure',send);addEventListener('load',send);if(typeof ResizeObserver!=='undefined')new ResizeObserver(send).observe(document.body);requestAnimationFrame(send)})()</script>`
}

function createThemeApplyScript(overflow: 'auto' | 'hidden'): string {
  // Keep the runtime theme builder aligned with buildHtmlSandboxThemeCss().
  return `<script>(()=>{const overflow=${JSON.stringify(overflow)};const buildCss=theme=>{const textColor=theme==='dark'?'#d8d8d8':'#2b2b2b';const root=':root{color-scheme:'+theme+';font-family:system-ui,sans-serif}';if(overflow==='auto'){const thumb=theme==='dark'?'rgba(210,210,210,.35)':'rgba(100,100,100,.35)';const thumbHover=theme==='dark'?'rgba(210,210,210,.6)':'rgba(100,100,100,.6)';const scrollbar='*{scrollbar-width:thin;scrollbar-color:'+thumb+' transparent}*::-webkit-scrollbar{width:12px;height:12px;background:transparent}*::-webkit-scrollbar-button{display:none;width:0;height:0}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background-color:'+thumb+';background-clip:content-box;border:4px solid transparent;border-radius:9999px}*::-webkit-scrollbar-thumb:hover{background-color:'+thumbHover+'}';return root+'html{height:100%;width:100%;margin:0;overflow:hidden}body{height:100%;width:100%;margin:0;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;overscroll-behavior:contain;background:transparent;color:'+textColor+'}'+scrollbar}return root+'html,body{margin:0;overflow:hidden;background:transparent;color:'+textColor+'}'};const apply=theme=>{document.documentElement.style.colorScheme=theme;document.documentElement.dataset.theme=theme;const style=document.getElementById('opencode-html-theme');if(style)style.textContent=buildCss(theme);dispatchEvent(new CustomEvent('opencode-theme-change',{detail:{theme}}));dispatchEvent(new Event('resize'))};addEventListener('message',event=>{if(event.data?.type==='opencode-html-theme')apply(event.data.theme)})})()</script>`
}

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
  const viewportHead = parsed.head.querySelector('meta[name="viewport"]') ? '' : HTML_SANDBOX_VIEWPORT_HEAD
  const themeHead = `<style id="opencode-html-theme">${buildHtmlSandboxThemeCss(theme, overflow)}</style>`
  parsed.head.insertAdjacentHTML('afterbegin', `${securityHead}${viewportHead}${themeHead}`)
  parsed.body.insertAdjacentHTML(
    'afterbegin',
    `${createThemeApplyScript(overflow)}${createHtmlSandboxMeasureScript(resizeId)}`,
  )
  return `<!doctype html>${parsed.documentElement.outerHTML}`
}
