# 非 AI 响应式、可访问性与性能验收

范围：战术板、非 AI 工具、模块导航、保存、球员表单、战术库、导入导出、触控布局和减少动态效果。按用户本轮要求排除所有 AI 功能与 GitHub Pages。

## 已发现的实际缺陷

主验收者使用运行中的 Chromium 和同源验收 iframe 发现：原版小手机 375 × 667 附近的绘图工具位于底部导航之后，844 × 390 附近的画板被标题与控制区推到首屏之外。初次 iframe 边框导致实际 CSS 视口少 2px，主验收者已指出并修正；修正前尺寸不能冒充目标精确尺寸。

根因是三项约束叠加：初始板高与 CSS 同时强制最小 280px；窄容器将七项工具排成两行；标题操作与尺寸控件继续占用纵向空间。桌面普通宽度没有暴露这条路径。

## 修复及边界

- `board-layout.js`：紧凑工作区最小 200px，普通桌面仍为 280px；默认高度预算基于真实控件，短横屏采用左右分配预算；滑块与 ARIA 最小值同步。
- 手机：标题及保存状态保留；重复的撤销／重做入口使用已有常驻底栏；镜像、复制保留。七项绘图工具单行，每项至少 44px，图标下保留可见短标签与现有 aria-label／title。
- 短横屏：画板位于左侧，模式入口在其下；尺寸、对象和绘图工具分配到右侧，避免继续纵向堆叠。展开、放大、尺寸入口保留。
- 用户明确拖动设置的尺寸继续保留；自动紧凑布局不能把手动调整默默清除。手机保存 200px 后切回桌面时临时遵守 280px 最小值，再回手机仍保留原偏好。
- 真实横屏复验进一步发现：桌面尺寸区的默认展开状态会迁移到横屏 popover 并覆盖绘图工具。现对窄屏、短横屏及竖横转换重新建立默认关闭状态；显式打开后可按 Escape 或点击外部关闭，Escape 将焦点还给尺寸入口。

这些是实现及已检查的逻辑边界。修复后的实际布局结果由主验收者的浏览器矩阵与截图记录，不能仅凭 CSS 或 DOM 单测认定通过。

## 本次已执行的专项自动化

命令：

```bash
node --test tests/compact-board-height.test.mjs tests/responsive-ui.test.mjs tests/board-projection-layout.test.mjs tests/viewport-layout.test.mjs tests/workspace-navigation-ui.test.mjs
```

结果：20 项通过，0 失败。证据见 [compact-layout-tests.txt](evidence/compact-layout-tests.txt)。覆盖实际尺寸预算、显式尺寸恢复、滑块／ARIA、尺寸 popover 转向和关闭恢复、透视缩放与滚动边界、粘性表头、导航焦点，以及双指隔离和取消／旋转回滚。这是 happy-dom 与领域布局测试，不是实际渲染引擎或 iOS 触摸证据。

## 可复现的精确视口 E2E

脚本：`scripts/qa-non-ai.mjs`。使用已安装的 Playwright 和 Chromium，不新增依赖、不开模型接口、不使用真实用户账号。每个视口有独立浏览器上下文与示例战术／DEPTH CHART，所有外部网络请求均被阻止。

| 编号 | CSS 视口 | 输入与偏好 |
| --- | --- | --- |
| desktop | 1440 × 900 | 鼠标、中文 |
| laptop | 1280 × 720 | 鼠标、中文 |
| ipad-landscape | 1024 × 768 | Chromium 模拟触摸 |
| ipad-portrait | 768 × 1024 | Chromium 模拟触摸 |
| mobile | 390 × 844 | Chromium 移动模拟与触摸 |
| small-mobile | 375 × 667 | Chromium 移动模拟与触摸 |
| mobile-landscape | 844 × 390 | Chromium 移动模拟与触摸 |
| desktop-en-reduced | 1440 × 900 | 英文、减少动态效果 |

每项检查覆盖初始工具和保存状态可达、球员拖动与撤销重做、整组拖动一次撤销、路线取消与完成、上下文入口与 Escape、输入焦点和保存后重载、名单表单取消与模块会话、跨队搜索和预览恢复、导出弹窗取消、完整备份下载／导入及撤销。触摸拖动使用 Chromium `Input.dispatchTouchEvent`，不是把鼠标结果称为触摸结果；也不是 Safari 或物理设备。

运行：

```bash
node scripts/qa-non-ai.mjs
UX_QA_CASES=small-mobile,mobile-landscape node scripts/qa-non-ai.mjs
UX_QA_OUTPUT=/tmp/non-ai-check node scripts/qa-non-ai.mjs
```

当前隔离 Chromium 的正常启动已被主验收者实际尝试，singleton socket 被执行环境以 `Operation not permitted` 拒绝。本脚本没有重复启动或绕过限制；[non-ai-matrix.json](evidence/non-ai-matrix.json) 明确记录 8 个视口 **not-run／blocked**，没有产品通过结果。主验收者的同源 iframe CSS 布局验收是另一类证据，不能把其结果填入本 Playwright 触摸矩阵。

## 性能证据

`scripts/acceptance-performance.js` 提供只读采样：

```js
const idle = await sampleFrames(frame.contentWindow).promise;
const drag = await armFieldDragSample(frame.contentWindow, { onState });
```

它记录当前窗口／iframe 的 rAF 中位、P95、最大帧间隔、超过 50ms 的间隔、可用时的 longtask、样本数与对象数量。拖动采样必须等到实际画板指针移动并抬起，单纯点“开始”或点一下棋子不算拖动；超时、取消和样本不足独立记录。没有完成手势会标记 not-run。

E2E 中的 `performance-sample` 只代表成功取得足够测量，不代表性能已达标。P95 超过 50ms 或单个长任务超过 150ms 会标记待复核。云端浏览器样本不能代表 iPhone/iPad 帧率，也不能在缺少同条件改造前数据时声称提升百分比。Safari、真实触摸、软键盘、系统手势与物理设备的性能仍须分别验收。
