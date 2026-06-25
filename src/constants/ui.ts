/**
 * 底部判断阈值 —— 三个功能共用同一个值：
 * 1. to-bottom 按钮：用户滚动超出该距离，按钮显示
 * 2. auto-follow：新内容是否自动跟随（userScrolled 在该阈值内为 false）
 * 3. auto-snap：内容增长时，接近底部是否自动吸附到底部
 */
export const AT_BOTTOM_THRESHOLD_PX = 60

/**
 * Sub-pixel 容差 —— 用于"scrollTop 是否本质上等于标记的 bottom 位置"，
 * 区分"我们自己 scrollToBottom 触发的 scroll"和"用户的 scroll"。
 * 与 AT_BOTTOM_THRESHOLD_PX 是不同概念，单独命名避免 magic number。
 */
export const BOTTOM_NUDGE_TOLERANCE_PX = 2
