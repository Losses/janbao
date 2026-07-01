# FAB 深页边界修复方案 v2（5/5 PASS，已并入 v2.1 审计后修订）

## v2 相对 v1 的修订（响应 5/5 FAIL 审计）

v1 的阻断问题：新增 family `'deep'` + 复用 Activity 的 `kind: 'dynamic'` 分支。审计一致否决，原因：

- Activity 的 `dynamic` 分支守卫 `pager.active`（`FloatingActionButtonLayer.svelte:164`），深页 GesturePageLayout 静止时发布 `active: false`（`GesturePageLayout.svelte:399-407`），`fabConfig` 返回 null，atom 不挂载，缺陷原样保留。
- 新增 `'deep'` 字面量需在 `fractionFromSample`、`familyNeedsSamplerDuringDrag`、`familyRestsAtSampleOne`、`forwardNavHoldoverActive`、`transitionEnabled`、`familyCInFlight` 等 6+ 处复制 overlay 分支；v1 漏了 `fractionFromSample`（:271），导致 messages 源深页整段 scale 恒为 0。

v2 改为：**不新增 family，直接复用 `overlay`**；新增 kind 字面量 `'deep'`，在 `fabConfig` 派生里**单独解析**（不读 `pager.active`），返回一个 family 为 `overlay`、kind 为具体 `discussions|messages` 的配置。这样 overlay 的全部既有分支（`fractionFromSample` 的 `listForegroundFromThreadCover`、`familyRestsAtSampleOne`、`familyNeedsSamplerDuringDrag`、`forwardNavHoldoverActive`、`chipExitActive` 短路、`familyCInFlight` 不触发、SSR 静止分支返回 0）自动复用，无需新增任何 family 分支。

## 缺陷回顾

悬浮加号按钮（FAB）在 7 条 FAB 路由与非 FAB 路由之间跳变，无缩放动效。根因三处，同源：挂载守卫 `{#if fabConfig !== null}`（`FloatingActionButtonLayer.svelte:555`）+ `ROUTE_CONFIGS`（`route-config.ts:59`）只给 7 条路由声明 `fab` + sampler arm effect 在 `!hasCfg` 时 disarm（:372）。实证见 `e2e/fab-deep-page-boundary.spec.ts`。

## 修复目标

非 FAB 的 GesturePageLayout 路由上 FAB 表现与帖子页（Family B overlay）一致：静止挂载 scale 0；前向进入时随 slide-in 从 1 缩到 0；back-swipe 时跟手从 0 长到 1。

## 选定方向：复用 overlay family + 新增 deep kind

24 条非 FAB 的 GesturePageLayout 路由配 `fab: { family: 'overlay', kind: 'deep' }`。`fabConfig` 派生对 `kind: 'deep'` 单独解析：从 `navStore.backTarget` 解析源列表 kind（back target 为 `/` → discussions，为 `/messages/inbox` → messages，其余默认 discussions），返回 `family: 'overlay'` + 具体-kind 的配置，**不经过 Activity 的 `pager.active` 守卫分支**。

不采用 CSS 过渡方向（不跟手指）。不新增 family（避免 6+ 处分支复制）。

## 具体改动

### 1. `src/lib/utils/route-config.ts`

- `FabRouteConfigMetadata.kind` 的联合类型增加 `'deep'`：`kind: FabListKind | 'dynamic' | 'deep' | null`。
- 给 24 条非 FAB GesturePageLayout 路由补 `fab: { family: 'overlay', kind: 'deep' }`。按现有 regex 条目归类：
  - 已有 `getParent`+`previewPanel` 条目，补 `fab`：`/profile/settings`、`/profile/[id]/[slug]`、`/profile/comments/[id]/[slug]`、`/profile/discussions/[id]/[slug]`、`/profile/invitations`、`/profile/(appearance|edit|editor|offlineReading|onlineNow|password|picture|preferences)`、`/admin/(backups|categories|maintenance|permissions|stats|user-groups)`、`/admin`。
  - 新增独立条目：`/bookmarks`、`/search`、`/notifications`、`/profile`。
- 保持不变：`/discussion/`、`/messages/\d` 仍是 `family: 'overlay'` + 静态 kind；两个 compose 路由不变；Activity 仍是 `family: 'list', kind: 'dynamic'`。
- 新增导出 `backTargetListKind(backTargetHref: string | null): FabListKind`：`/messages/inbox` → messages，其余（含 null）→ discussions。供 `fabConfig` 与可能的其他调用方使用。
- 更新 `sourceListKindForOverlayOrCompose`（:174）：对 `kind: 'deep'` 返回 null（它不是静态源列表 kind；deep 的 kind 由 `fabConfig` 运行时解析）。核查所有调用方不被破坏。

### 2. `src/lib/utils/fab-scale.ts`

- 不改。`FabFamily` 仍为 `'list' | 'overlay' | 'compose'`。`familyNeedsSamplerDuringDrag`、`familyRestsAtSampleOne`、`fractionFromSample`（经层调用）对 overlay 的既有行为全部适用于 deep 路由。

### 3. `src/lib/components/templates/FloatingActionButtonLayer.svelte`

- `fabConfig` 派生（:144）：在现有 `dynamic` 分支与静态分支之间，新增 `kind === 'deep'` 分支：
  - 读 `navStore.backTarget`，经 `backTargetListKind` 解析为具体 `FabListKind`。
  - 返回 `{ kind: resolvedKind, family: 'overlay', href, label, icon, tabIndex }`，其中 href/icon/label/tabIndex 取自 `FAB_KIND_CONFIGS[resolvedKind]`。
  - 不读 `pager.active`，不读 `sampledFractionalIndex`。SSR 与客户端静止都返回非 null。
- 挂载守卫 `{#if fabConfig !== null}`（:555）不变。deep 路由现在 `fabConfig` 非 null，atom 挂载。
- sampler arm effect（:369）：`hasCfg = rule.fab.kind !== null`。deep 的 `kind: 'deep'` 非空，`hasCfg` 为 true，sampler 正常 arm。静止时 `familyRestsAtSampleOne('overlay')` 为 true，track 停在 sample 1，sampler 首帧读到 sample 1 自停（:324）。核查不产生反复 arm/disarm。
- `fractionFromSample`（:271）：deep 路由 cfg.family 为 `overlay`，走 `listForegroundFromThreadCover(sample)`，正确，无需改。
- `forwardNavHoldoverActive`（:461）：family 判定已是 `overlay || compose`，deep（overlay）自动覆盖，无需改。
- `chipExitActive`（:424）：`family !== 'list'` 短路 false，无需改。
- `foregroundFraction` 静止分支（:526）：`family !== 'list'` 返回 0，无需改。
- `familyCInFlight`（:209）：只在 compose↔list 翻转 latch，deep（overlay）不触发，无需改。
- SSR：deep 路由 `fabConfig` 非 null，静止 fraction 0，SSR HTML 携带 `scale(0)`，不闪 1。核查 `navStore.backTarget` 在 SSR 的初值（`initialNavState`）经 `backTargetListKind` 给出合理默认（默认 discussions），不影响 scale（静止 0）。

### 4. `e2e/fab-deep-page-boundary.spec.ts`

- 翻转 4 个 DEFECT 测试为断言正确轨迹：atom 全程在 DOM、scale 单调、存在 (0.1, 0.9) 中间值。作为预防性回归测试。
- CALIBRATION 调整：deep 路由上 atom 存在且 scale 0。
- 新增 `/` → `/search` 前向轨迹（核查外层 GPL track slide-in 被 sampler 读到，内嵌 SearchScopePager 不干扰）。
- 新增 `/messages/inbox` → `/bookmarks` 轨迹（messages 源的 deep 路由，核查 `fractionFromSample` 不把 scale 卡在 0）。
- 新增 SSR 断言：deep 路由原始 SSR HTML 中 FAB `style` 携带 `scale(0)` 且不含 `function(`。

## 已接受的退化情形（审计 major 项的处置）

- 前向进入深页时若 `shouldAnimateEnter`（`GesturePageLayout.svelte:232`）不成立（`leftNeedsLoading` 为真、`direction !== 'forward'`、`activeStack.length < 2`、`prevPath !== resolvedLeftHref`），slide-in 不播，sampler 无 track 动可读，atom 直接以 scale 0 出现，无 scale-out 动效。正常移动端流程（列表点链接进深页：direction forward、stack ≥2、prevPath===backTarget、root layout 已 eager-load 三 tab 故 leftNeedsLoading=false）下 slide-in 会播，sampler 跟读。退化情形不在常见路径，接受无动效（不闪 1，因静态分支返回 0）。
- `forwardNavHoldoverActive` 的 `!samplerHasPublished` 闸口：slide-in 播放时 sampler 首帧读到 slide 起点（foregroundFraction≈1），与 holdover 的 1 无缝衔接；slide 不播时本就无动效，闸口翻转无副作用。核查 holdover 在 slide 播放路径上不产生 1→0 跳变。

## 审计要点（v2 agent 须独立核查）

- `kind: 'deep'` 分支是否真的绕开 `pager.active` 守卫，SSR 与客户端静止都返回非 null。
- `fractionFromSample` 对 deep（family overlay）是否走 `listForegroundFromThreadCover`，messages 源深页 scale 是否跟手。
- `navStore.backTarget` 在 SSR 与深页→深页导航时的取值，`backTargetListKind` 是否给出合理默认，深页→深页切换是否闪 scale 1。
- `sourceListKindForOverlayOrCompose` 增加 'deep' 处理后，所有调用方（grep）是否不被破坏。
- sampler 静止自停：是否反复 arm/disarm，是否无限 rAF。
- 24 条路由枚举与 `grep -rln GesturePageLayout src/routes` 是否完全对应，无漏无多余。
- 前向进入常见路径（列表→深页）slide-in 是否真播，sampler 是否真跟读，holdover 是否无缝。
- `/search` 外层 GPL track 与内层 SearchScopePager 是否互不干扰。
- 是否仍有更优统一做法。

## v2.1 审计后修订（5 个 agent PASS 时一致指出的落地必做项）

第二轮 5/5 PASS，方向与枚举确认无误。以下为实现层必须执行、否则编译或测试会失败的细节，v2 漏写，现补齐：

1. **`backTargetListKind` 必须按 pathname 匹配，剥离 search。** `backTargetFor`（`navigation-logic.ts:61`）返回 `pathname + search`，`/messages/inbox?page=2` 会让精确等于 `/messages/inbox` 的判断失败，错误降级为 discussions。实现：取 pathname 比较（`new URL(backTarget, 'http://x').pathname`，或按 `?` 截断）。加单测覆盖 `?page=2` 情形。

2. **`sourceListKindForOverlayOrCompose`（`route-config.ts:174`）必须对 `'deep'` 返回 null。** 现实现直接 `return rule.fab.kind`；kind 联合加入 `'deep'` 后会返回字面量 `'deep'`，类型与语义均错。实现：`if (kind === 'dynamic' || kind === 'deep') return null;`。必做的字面改动。

3. **`fabConfig` 派生里 `kind === 'deep'` 分支必须置于静态分支之前并早返回。** 静态分支 `FAB_KIND_CONFIGS[rule.fab.kind]`（`:181`）索引 `Record<'discussions'|'messages', ...>`，`'deep'` 落入会取到 `undefined` 再 `.href` 崩溃。实现顺序：`dynamic` 分支 → `deep` 分支（早返回）→ 静态分支。加注释说明静态分支依赖 deep 早返回。

4. **`isOverlayRoute`（`route-config.ts:156`）语义保持「帖子/会话 overlay」，收紧为排除 deep。** 现实现 `rule.fab?.family === 'overlay'`；v2 后 `/bookmarks`、`/profile/*`、`/search` 等都会变成 overlay，使 `fab-routes.test.ts:32-34`（断言这三条 `isOverlayRoute === false`）失败。`isOverlayRoute` 与 `isComposeRoute` 无生产调用方（grep 确认，仅测试调用）。实现：`isOverlayRoute` 改为 `family === 'overlay' && kind !== 'deep'`，保持既有语义与既有测试零修改；deep 路由的识别由 `getRouteFabRule(...)?.fab.kind === 'deep'` 表达，不新增导出。

5. **`startSampler`（`:278`）不重置 `sampledFractionalIndex`，只重置 `samplerHasPublished`。** 保留上一路由的 sample 值是承载性的：Family B 前向进入时 sampler 首帧会读到帖子 track 的静止位置（sample=1，对应 scale 0），而残留的旧 sample（来自源列表路由，≈0）经 `listForegroundFromThreadCover` 恰好给出 fraction≈1，桥接 sampler 首次发布到 enter slide 真正开始之间的间隙。若重置为 null，首帧静止读数会暴露成单帧 scale 0，破坏 Family B forward 的单调轨迹（实证 3/3 失败）。第二轮审计建议的重置项在此被实证否决。

6. **单测补充（`fab-routes.test.ts`）。** 加：`getRouteFabRule('/bookmarks')?.fab.kind === 'deep'`；`sourceListKindForOverlayOrCompose('/bookmarks') === null`；`isOverlayRoute('/bookmarks') === false`（保持）；`backTargetListKind('/messages/inbox?page=2') === 'messages'`。

7. **深页→深页前向 holdover 的 1 帧 scale=1（已接受退化的精确化）。** 当 `shouldAnimateEnter` 不成立时（跨 tab 进入、`leftNeedsLoading`、popstate），`forwardNavHoldoverActive` 可能在新路由首帧把 fraction 钉在 1，下一帧 sampler 读到静止 sample 1 自停后回落 0，形成 ≤1 帧 scale=1，肉眼不可察。若要彻底消除，可给 `forwardNavHoldoverActive` 增加「目标 deep 路由的 `resolvedLeftHref === navStore.activeStack` 倒数第二项」护栏，只在 slide 会播时 holdover。默认接受 ≤1 帧；e2e 的深→深导航断言只验「atom 全程在 DOM、落地 scale 0、不持续闪 1」。

## 审计结论（第二轮 5/5 PASS）

5 个独立 agent 一致裁决 PASS：v1 两个阻断点（`pager.active` 守卫、`fractionFromSample` 漏 deep）经「复用 overlay family + 新增 deep kind 单独解析」机械地绕开；SSR `scale(0)` 不变量成立；sampler 静止自停无循环；枚举 24 条精确匹配；`/search` 内外 pager 隔离；无更优统一做法。v2.1 并入的 7 项为实现层落地必做。
