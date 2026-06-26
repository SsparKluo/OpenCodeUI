import { useSyncExternalStore } from 'react'
import { CodeMirrorReadonly } from './CodeMirrorReadonly'
import { codeLineHeight } from './codeMirrorReadonlyExtensions'
import { useSyntaxHighlightRef } from '../hooks/useSyntaxHighlight'
import { themeStore } from '../store/themeStore'
import { CopyButton } from './ui'

interface CodePreviewProps {
  code: string
  language: string
  maxHeight?: number
  isResizing?: boolean
  wordWrap?: boolean
}

export function CodePreview({ code, language, maxHeight, isResizing = false, wordWrap }: CodePreviewProps) {
  const { codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: language !== 'text',
  })

  return (
    <div className="group/code relative h-full w-full">
      <div className="absolute top-1 right-1 z-10 opacity-0 group-hover/code:opacity-100 group-focus-within/code:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
        <CopyButton
          text={code}
          position="static"
          className="!h-7 !w-7 !p-1.5 rounded-md bg-bg-300/70 backdrop-blur-md"
        />
      </div>
      <CodeMirrorReadonly
        code={code}
        tokensRef={tokensRef}
        tokensVersion={version}
        wordWrap={resolvedWordWrap}
        lineHeight={codeLineHeight(codeFontScale)}
        maxHeight={maxHeight}
        isResizing={isResizing}
      />
    </div>
  )
}
