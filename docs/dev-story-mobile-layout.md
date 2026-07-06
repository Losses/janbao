# 移动端布局：从底栏到滑动 Tab 的开发记录

本文记录 2026-06-19 至 2026-06-25 期间移动端布局的改动。起点是固定的底部导航栏（`BottomNav.svelte`），终点是可滑动、可品牌化、带跟随手指动效的顶部 Tab 条（`MobileTabBar.svelte` + `MobileTabPager.svelte`）。中间夹着手势系统的一次完整重写、一次同日被回退的架构改造，以及持续到最后一天的滚动与对齐修正。

记录以提交时间为顺序，每一步给出提交号、改动文件与具体的技术内容。

## 时间线

| 提交    | 日期        | 内容                                               |
| ------- | ----------- | -------------------------------------------------- |
| 2d1d418 | 06-19 17:05 | 引入底部导航栏 `BottomNav.svelte` 与滚动隐藏机制   |
| 47810e1 | 06-20 00:53 | 删除底栏，新建 `MobileTabBar.svelte` 与 `swipe.ts` |
| 4b6065a | 06-20 11:06 | 新建 `MobileTabPager.svelte` 与三个 tab 面板       |
| 89a7573 | 06-20 11:15 | 将离线子系统接入移动端 tab 面板                    |
| cc0b0bb | 06-20 11:52 | 品牌化首个 tab（Branded tab）                      |
| 911409b | 06-20 12:22 | tab 标签随手指拖动的裁剪动效（Clip animation）     |
| c425b8a | 06-20 18:07 | 抽象滑动手势设计                                   |
| f216f73 | 06-20 23:11 | 移动端功能页（profile/admin/settings）             |
| bb01dae | 06-21 12:51 | 左侧预览滚动对齐 `leftPreviewScroll`               |
| b465957 | 06-21 22:13 | 前进 list→thread 的滑入动效与 `thread-nav`         |
| 929fec5 | 06-22       | 改造内页导航为 overlay 层                          |
| c339b2d | 06-22       | 回退 overlay 改造                                  |
| a70275a | 06-23 00:01 | 彻底重写导航手势                                   |
| 8715c53 | 06-23 22:57 | `overflow: hidden` 改为 `overflow: clip`           |
| 23b94e0 | 06-24 15:12 | 修复边缘死区锁死手势状态                           |
| 05ef27c | 06-24 16:14 | 深层页手势 pill 对齐                               |
| 491e212 | 06-25 10:23 | 修复窗口缩放冻屏                                   |
| 17e1539 | 06-25 19:04 | 修复详情页滚动容器来源                             |

## 起点：底栏

提交 2d1d418（06-19 17:05）`refactor: Mobile layout and settings layout` 之前，移动端没有专用的主导航，只有 Header 右上角的汉堡按钮。这次提交加了三个文件：

- `src/lib/components/organisms/BottomNav.svelte`（108 行）：固定在底部的导航栏，三个 tab--Discussions（`mdiForum`，`/`）、Activity（`mdiLightningBolt`，`/activity`）、Messages（`mdiEmailOutline`，`/messages/inbox`，带未读 badge）。容器类名 `fixed bottom-0 left-0 right-0 z-40 ... md:hidden`，桌面端隐藏。
- `src/lib/stores/scroll-chrome.svelte.ts`（82 行）：驱动 Header 与底栏在滚动时隐藏的状态。核心字段 `hidden`、`translateY`、`headerHeight`（默认 56px）；阈值 `TOP_THRESHOLD = 8`、`DIRECTION_THRESHOLD = 4`；单个 rAF 节流的 passive scroll 监听。向下滚动隐藏，向上滚动显示，接近顶部强制显示。
- `src/lib/utils/nav-active.ts`（10 行）：`isNavActive(pathname, href)`，`href === '/'` 时严格相等，否则前缀匹配。

Header 同时被重排：汉堡按钮从右侧移到左侧，右侧加搜索图标；`DualColumnLayout` 的抽屉从 `drawer-end`（右侧出）改为 `drawer`（左侧出），底部 padding 从 `pb-6` 加到 `pb-20`，并在 `onMount` 启动 scroll-chrome 监听。

底栏只保留了一天。它占据底部空间，且与手势导航没有交集。第二天的第一件事就是把它拆掉。

## 从底栏搬到顶栏：手势系统落地

提交 47810e1（06-20 00:53）`feat: Gesture system for mobile platforms` 做了两件事：删除 `BottomNav.svelte`，新建 `src/lib/components/organisms/MobileTabBar.svelte` 与 `src/lib/actions/swipe.ts`。导航从屏幕底部移到顶部 App Bar 内，变成一条 tab 条。

`swipe.ts` 提供两个动作：

- `captureSwipe`：在 `pointerdown` 时调用 `setPointerCapture` 并设置 `touch-action: none`，独占整次手势。用于没有原生行为竞争的表面（抽屉边缘、遮罩）。
- `detectSwipe`：运行在会纵向滚动的页面上，保留原生纵向滚动，仅在拖动明显偏向横向时接管。用于 tab 间左右切换。

阶段机：`'idle' | 'deciding' | 'swipe' | 'ignore'`。初始阈值 `DEAD_ZONE = 10`、`HORIZONTAL_RATIO = 1.4`、`LONG_PRESS_MS = 350`、`CLICK_THRESHOLD = 6`。`deciding` 阶段判断横向/纵向、是否长按、是否落在可编辑元素上，命中横向则进入 `swipe` 并请求指针捕获，否则进入 `ignore` 交还浏览器。

七小时后，4b6065a（06-20 11:06）`feat: Gesture system` 加上 `src/lib/components/templates/MobileTabPager.svelte`（193 行）与三个面板组件 `DiscussionsPanel`、`ActivityPanel`、`MessagesPanel`。这是“Tab”真正成形的一步。

`MobileTabPager` 是一个三联横向轨道：容器宽度 300%，三个面板各占 1/3 视口。核心状态：

```ts
const STEP_PERCENT = 100 / MOBILE_TABS.length; // 33.33%
const SWIPE_COMMIT = 60; // 释放时越过 60px 提交切换
let activeIndex = $state(initialIndex());
let dragOffset = $state<number | null>(null);
```

轨道位移在拖动时为 `translateX(calc(-{activeIndex*STEP_PERCENT}% + {dragOffset}px))` 并关闭过渡（`transition: none`），静止时回退到带过渡的 `translateX(-{activeIndex*STEP_PERCENT}%)`。`follow(deltaX)` 在首尾两端把位移乘以 0.4 做橡皮筋。三个面板同时挂载，切换 tab 不重建组件、保留滚动位置与列表数据。

同一次提交还改了 `src/app.css`（加 `touch-action` 相关规则）与 `src/hooks.server.ts`。

## 品牌化与裁剪动效

47810e1 落地后两小时出现连续两个 feature 提交。

cc0b0bb（06-20 11:52）`feat: Branded tab`：当环境变量 `PUBLIC_BRANDED_FIRST_TAB` 为真时，首个 tab 不再显示 `mdiForum` 图标与“Discussions”文字，改用新建的 `src/lib/components/atoms/LogoGeometry.svelte`（圆形轮廓 SVG）与 `LogoText.svelte`（字标 SVG），两者都用 `currentColor` 继承 tab 的激活/非激活颜色。Header 同时从两行结构压成单行。判定逻辑：

```ts
const brandedFirstTab = ['1', 'true', 'yes'].includes(
	(env.PUBLIC_BRANDED_FIRST_TAB ?? '').trim().toLowerCase()
);
```

911409b（06-20 12:22）`feat: Clip animation`：tab 标签随手指拖动展开与收起。机制是 `max-width` 从 0 到 8rem、`margin-left` 从 0 到 0.375rem，配合 `overflow-hidden` 裁掉溢出文字。不用透明度，也不用 Svelte 过渡指令，纯 CSS。进度由新建的 `src/lib/stores/mobile-pager.svelte.ts` 提供：

```ts
interface PagerUpdate {
	fractionalIndex: number; // activeIndex + 拖动偏移的小数部分
	dragging: boolean; // 拖动中关闭过渡，做到 1:1 跟手
	active: boolean;
}
```

`closeness(index) = 1 - abs(fractionalIndex - index)`，夹到 [0,1]。拖动时 `transition: none`，松手后 `max-width 200ms ease-out, margin-left 200ms ease-out`。

这两步合在一起，就是“底栏到 Tab”这条线的终点形态：一条放在顶部的、可品牌化、标签会随手势开合的滑动 tab 条。

## 接入离线与移动端功能页

89a7573（06-20 11:15）`feat: Integrate offline system into the mobile view` 把 DV06/DV07 的离线子系统接进刚建好的面板。`DiscussionsPanel` 在离线时从 IndexedDB 读缓存并以 `LoadingChip` 占位，行链接指向 `/offline/{id}` 阅读器，隐藏收藏星与分页；`ActivityPanel` 离线时隐藏发布框与分页器。新增 `src/lib/offline/queries.ts` 的 `mapOfflineDiscussionRow` 把缓存行投影回 `DiscussionRowItem` 形状。

f216f73（06-20 23:11）`feat: Mobile feature view` 给 profile、admin、settings 加了移动端目录页。新建 `src/lib/components/molecules/DirectoryGrid.svelte`，按分组列出带图标的导航行（`group flex items-center gap-3.5 p-4`，尾部 `mdiChevronRight`）。服务端按 User-Agent 判定移动端，客户端用 `matchMedia('(max-width: 767px)')` 在桌面端重定向到对应的桌面路由。

## 手势边界条件与第一轮稳定

品牌化之后是一连串边界修正，集中在 06-20 下午到深夜。按问题归类：

- **slicing 与空白区**：c05594c（06-20 17:13）`fix: Gesture slicing regression`，`detectSwipe` 与内容平移在同一冒泡触摸上竞争；修正是在 pager 路由上禁用 `DualColumnLayout` 的 swipe。73c3b94（06-20 17:50）`fix: Gesture on blank space is note detected`，底部空白区检测不到手势；把 viewport 的 `min-height: 100%` 改成 `flex: 1 0 auto`。
- **抽屉与点击**：1184a49（06-20 14:25）抽出 app drawer。a79d900、34e2e78 修 `suppressNextClick` 漏放行导致的误吞点击。
- **抽屉边缘与遮罩**：c425b8a（06-20 18:07）`refactor: Generalize the slide gesture design`，把滑动手势抽象成可复用设计。
- **Header 跟随手势**：ac487c6（06-20 22:34）`fix: Header should auto show while triggering the gesture`，在 `tabSwipeMove`、`swipeMove`、提交分支里调用 `getScrollChromeStore().show()`；并把 `neighborOffset` 从 `max(0, scrollY - viewportDocTop)` 直接改成 `scrollY`，删掉 `viewportDocTop` 状态。
- **指针捕获健壮性**：bef39d0（06-20 23:39）把 `setPointerCapture`/`releasePointerCapture` 包进 try-catch，`suppressNextClick` 加 400ms 兜底定时器，桌面断点切换时关闭抽屉。b51db68（06-21 00:21）继续修指针捕获。

这一段暴露出一个贯穿全程的事实：`GesturePageLayout` 会锁住 window（`html.fixed-viewport`），真正的滚动发生在 `.detail-scroll-pane` 容器里。后续所有“滚动不隐藏 Header”“滚动位置丢失”的问题，根因都指向这个容器来源。

## overlay 改造的尝试与同日回退

06-22 出现一次架构级改造，并在同一天被回退。

929fec5 `refactor(mobile): Inner page navigation` 想把内页（讨论、会话）做成常驻 `MobileTabPager` 之上的 overlay 层。新建 `src/lib/components/templates/OverlayLayer.svelte`（27 行，`relative z-20`，in-flow 以驱动文档高度），新建 `src/lib/stores/overlay-sidebar.svelte.ts` 把内页侧栏片段注册进 overlay 系统，并改 `ThreadPager`。目标是 pager 永不卸载、内页作为 overlay 覆盖、swipe-back 时保留左侧列表预览。

随后两个修补：78c8496 `fix: The transparent area`、30dbaad `fix: Jumpy visual effect while navigating back`。

c339b2d `revert: roll back mobile thread overlay refactor` 把上述三个提交全部回退（70 个文件，+815 / -1340）。回退说明列出的级联问题：`overflow-hidden` 裁切容器造成的程序化滚动锁、SSR/水合时面板空白、重回 in-flow 时的高度跳动、每帧调试日志导致的性能崩溃，以及最关键的一点--最初要修的 swipe-back 白闪并没有被修好。提交说明明确写到：后续会用一个数据驱动的小改动来解决，而不是重写架构。

这次回退在仓库里留下了清晰的教训：保留常驻 pager 的方向是对的，但用 overlay 层加裁切容器去实现会引入四类难以同时解决的新问题。

## 彻底重写导航手势

回退之后一小时，a70275a（06-23 00:01）`refactor: Totally rewrite the navigation gesture` 是整个周期里改动量最大的提交。新增与重写：

- `src/lib/stores/navigation.svelte.ts`（137 行）：每个 tab 维护一条虚拟历史栈。`#stacks = {0:[{pathname:'/',...}], 1:[...activity], 2:[...messages]}`。`init(initialPath)` 在落到非根页时合成 `[root, current]`，使 swipe-back 落到列表；`backTarget` 取当前栈倒数第二项。
- `src/lib/stores/list-cache.svelte.ts`（97 行）：每个 tab 的列表数据缓存，切换 tab 时即时回填，配合 4b6065a 的常驻面板做到切换不重新请求。
- `src/lib/components/templates/GesturePageLayout.svelte`（675 行）：接管内页手势。用 `detectSwipe` 检测，多面板 pager（左/中/右），`maxDrag = innerWidth * 0.3`、`SWIPE_COMMIT = 60`，`listScrollTop`/`detailScrollTop` 分别保存列表与详情的滚动位置，与 `navigation` 的 `backTarget`、`list-cache` 的内容协同。
- `ThreadPager` 重写，`swipe.ts` 调整：`HORIZONTAL_RATIO` 从 1.4 提到 1.6，加 40px 边缘死区（避开系统边缘返回手势），加 `preventTouchMove` 在 `swipe` 与横向占优的 `deciding` 阶段锁纵向滚动。

这一天剩下的提交都是在给这套新系统补稳定性：

- 3790be1（10:37）`fix: Drifting effect`：滚动恢复加 `requestAnimationFrame` 兜底，`onscroll` 只在 `scrollTop > 0` 时捕获，`listScrollTop` 从 `listScroll.captured` 初始化。
- a50225e（11:02）`feat: Adapting gesture to more pages`、278f899（11:18）`feat: Detailed navigation behavior`：把手势推广到更多页面并细化返回行为。
- 178bbba（14:49）`fix: Mobile platform animation disappeared`：加 `transitionEnabled` 标志，用 `void trackEl.offsetHeight` 强制重排后再用双 `requestAnimationFrame` 开启过渡。
- 6bd372b（14:53）`feat: Gesture disable`：提供手势开关。
- 4752c24（16:06）`fix: Back navigation`、e7ba6aa（16:26）`fix: Gesture and loading system`：返回目标与加载态。
- 6391086（21:33）`fix: Gesture blinking`：提交分支的 `setTimeout` 里先把 `transitionEnabled` 置 false 再重置状态，50ms 后再开，消除提交瞬间的轨道闪烁。
- 5f9d14b（22:19）`fix: Page switching alignment`：移动断点切换时 `window.scrollTo(0,0)`，并加 capture 阶段全局 scroll 拦截器，强制非 scroll-pane 元素滚动归零。
- ed0cee4（22:22）`fix: Page scrolling issue`：给 `html.fixed-viewport` 下 `DualColumnLayout` 的各层容器加 `min-height: 0 !important; height: 100% !important;`，修复锁窗时 flex 高度链塌陷。
- 8715c53（22:57）`fix: Stablize scrolling`：viewport 的 `overflow: hidden` 改成 `overflow: clip`，`transitionEnabled` 默认 true，简化进场动效，去掉双 rAF。

`overflow: hidden` → `overflow: clip` 这一步值得单独记一笔：`hidden` 仍然是一个可被程序化滚动的容器，`scrollIntoView` 会把页面锁到锚点；`clip` 不建立滚动容器，规避了这整类问题。

## 导航逻辑拆分与边缘死区修复

06-24 是拆分与测试。

816157d（14:20）`refactor: Navigation logic extraction` 把 `navigation.svelte.ts` 的纯逻辑抽到 `navigation-logic.ts`：`seedStackForLanding`（落地页栈初始化）、`backTargetFor`（取栈倒数第二项）、`initNav`、`switchTabNav`、`handleBeforeNavigateNav`。02d817e（14:45）`refactor: Navigation cache extraction` 抽出缓存部分。66983ce（10:01）`fix: Navigation` 与 be562dd（16:36）`feat: New test for the navigation behavior` 加了 Playwright E2E（`backtarget.spec.ts`），覆盖“从全局路由返回是否落到来源 tab”。

23b94e0（15:12）`fix: Gesture dead zone` 修的是一个高危锁死。40px 边缘死区在 `onDown` 里把 `phase` 设成 `'ignore'`，但在此之前没有记录 `primaryPointerId`。于是匹配的 `pointerup` 因 id 不符无法触发 `reset()`，状态机被永久卡在 `'ignore'`，之后所有横向手势都被静默丢弃，直到整页刷新。因为受影响的是常驻 `MobileTabPager` 视口（设计上跨 tab 导航不卸载），一次误触边缘就禁用了整个主表面的滑动导航。修正：把“只有 idle 才能开始追踪”的守卫提到死区检查之前，死区拒绝直接 `return` 不改动 `phase`。多指情形（第二指落进死区）也由同一个守卫挡掉。这次修正的完整复现与验证记录在 `docs/FX01-swipe-edge-deadzone-stuck-phase.md`。

05ef27c（16:14）`fix: Gesture not aligned` 处理深层页（`/bookmarks`、`/profile`、`/settings`，没有自己的 tab）。pager 的 pill 逻辑扩展到 `centerTab === undefined` 的页面：拖动时把 pill 从当前页所属 tab 指向 `backTarget` 所属 tab，提交后停在目标，静止时释放回 URL 对应的 tab。

## 收尾：滚动容器来源与窗口冻结

06-25 两个提交收尾。

491e212（10:23）`fix: Window resizing will freeze the screen`：桌面 list→thread 的 SPA 导向后，缩放到移动端会显示首页而非当前帖子。原因是 `MobileTabPager` 的 `snapIndex` 初始化用 `isEntering ? 0 : ACTIVE`，把桌面端的值钉死在 0（`enterRaf` 只在移动端跑）。修正：把初始化的 0 分支限定在移动端（`isEntering && isMobile ? 0 : ACTIVE`），不引入 `setTimeout` 或冻结。

17e1539（19:04）`fix: Discussion scrolling issue`：`GesturePageLayout` 路由上 Header 不再随滚动隐藏，因为 scroll-chrome store 只监听 window 滚动，而移动端详情页滚动发生在 `.detail-scroll-pane`。修正：给 scroll-chrome store 加 `setScrollContainer(el)`，`GesturePageLayout` 在移动端经 `$effect` 注册 `.detail-scroll-pane` 为滚动源；CSS 让 Header 在该容器下 `position: fixed` 并给容器加 `padding-top: calc(var(--header-height) + 0.75rem)`；`landAtAnchor` 对 hash 深链调用 `holdThroughNavigation(false)`。这是“滚动容器来源”这条线（06-20 ac487c6 就已出现）的最终修正。

## 最终架构

到 06-25 结束，移动端导航的结构是：

- 顶部 `MobileTabBar`（在 Header 内）：三个 tab，首个可品牌化，标签随拖动经 `max-width` 裁剪动效开合。
- `MobileTabPager`：300% 宽三联轨道，三面板常驻，`detectSwipe` 驱动 1:1 跟手与橡皮筋，`dragOffset` 静止时回弹。
- `GesturePageLayout`：内页（讨论、会话）层面，`detectSwipe` 检测 swipe-back，多面板 pager，锁 window、滚动在 `.detail-scroll-pane`。
- `DualColumnLayout`：`captureSwipe`（抽屉边缘/遮罩）+ `detectSwipe`（内页 tab 滑动）。
- `navigation.svelte.ts` + `navigation-logic.ts`：每 tab 一条虚拟栈，`backTarget`、`seedStackForLanding`、`switchTabNav`。
- `list-cache.svelte.ts`：每 tab 列表缓存，配合常驻面板即时回填。
- `scroll-chrome.svelte.ts`：Header 隐藏/显示，可切换监听 window 或 `.detail-scroll-pane`。
- `swipe.ts`：`captureSwipe` / `detectSwipe`，阶段机 `idle/deciding/swipe/ignore`，阈值 `DEAD_ZONE=10`、`HORIZONTAL_RATIO=1.6`、`LONG_PRESS_MS=350`、`CLICK_THRESHOLD=6`、边缘死区 40px。

## 反复出现的几个点

记录里反复指向同一组事实，单独列出：

1. **滚动容器不是 window**。`GesturePageLayout` 锁窗后滚动在 `.detail-scroll-pane`。scroll-chrome、scrollIntoView 锁页、`neighborOffset` 计算等问题，根因都在这里。
2. **`overflow: hidden` 仍是滚动容器**。改成 `overflow: clip` 后，程序化滚动锁页这一类问题消失。
3. **常驻 pager 的卸载策略**。tab 间切换不重建组件是性能与状态保留的前提，但也意味着任何把状态卡死在非 idle 的 bug（边缘死区）会持续整个会话。
4. **架构改造 vs 数据驱动修正**。overlay 层 + 裁切容器的方案一次性引入四类问题且没解决原始白闪；`navigation` 虚拟栈 + `list-cache` + `GesturePageLayout` 的重写用数据与状态管理达到了 overlay 方案想达到的常驻效果。
5. **进场动效依赖重排时序**。`transitionEnabled` 标志、`void offsetHeight` 强制重排、双 `requestAnimationFrame`、提交分支里临时关过渡，是同一类时序问题的重复处理。
