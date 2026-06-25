# TODO.md

## Goal
优化移动端输入框收起态：从「居中胶囊按钮 + 全高占位」改为「全宽紧凑栏 + 平滑动画」。移除 overlay 时代遗留的 expandedHeight 占位，复用本项目已有的 `transition-[grid-template-rows]` CSS 动画模式（同文件附件展开已用此法）。

## Approach
1. useMobileCollapse.ts — 移除 expandedHeight 状态 + 采样用的 ResizeObserver（占位已不需要；auto-scroll 仅在真实 scroll 事件更新 isAtBottom，不会抖动）
2. InputActions.tsx — CollapsedCapsule → CollapsedBar：全宽玻璃栏（圆角与输入框一致，capsule 高度，不可输入，点击展开），保留 scroll-to-bottom
3. InputBox.tsx — 移除 minHeight 占位 / justify-end；用两条 grid-rows track（收起栏 / 完整输入+footer）做交叉淡出 + 高度过渡；始终挂载，靠 0fr+overflow-hidden+pointer-events-none 隐藏

## Current Step
Done — typecheck / lint / test (22 passed) / build 全部通过

## Completed
- useMobileCollapse.ts: 移除 expandedHeight 状态 + 采样 ResizeObserver（占位已不需要）
- InputActions.tsx: CollapsedCapsule → CollapsedBar（全宽玻璃栏，capsule 高度，不可输入，点击展开）
- InputBox.tsx: 移除 minHeight 占位 / justify-end；两条 grid-rows track 做交叉淡出 + 高度过渡；footer 移入展开 track；始终挂载靠 0fr+overflow-hidden+pointer-events-none 隐藏
