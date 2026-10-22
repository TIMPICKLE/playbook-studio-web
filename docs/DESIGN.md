# Playbook Studio v3 交互与视觉改版

使用 [taste-skill 仓库的 redesign-existing-projects](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md) 指导现有应用改版。读取日期 2026-10-18。当时仓库主版 taste-skill v2 明确排除 dashboard / app screens，因此没有把用于营销展示页的随机构图、滚动固定或图片配额套用到战术编辑器。

## 改版依据

- 保留品牌绿色及真实 SVG 球场；让战术图成为主体，不使用无关装饰图。
- 降低细碎标签密度，提高表单、正文及操作按钮的可读性与对比度。
- 工具栏显示文字名称，保留快捷键；当前工具有明显状态。
- 绘制路线时显示「选择球员 → 点击路线点 → 完成保存」的具体步骤。
- 路线未完成时切换工具 / 战术 / 分类前确认，允许继续绘制。
- 替换带路线的阵型前说明会清除的路线、区域与标注数量，并提供取消。
- 登录、成员、保存、邀请等请求有忙碌状态，防止重复提交；失败显示在原表单内。
- 云端状态始终可见，提供立即保存；只读模式明确说明可用操作。
- 新建成员账号和 ChatGPT 邮箱邀请分开呈现；权限只作用于当前战术本。
- 重置密码说明会使旧登录失效；只允许管理员重置自己创建的账号。
- 保留可见焦点、键盘访问、对话框焦点约束和减少动画偏好。
- 手机使用独立的单列编辑器与抽屉式战术列表。

## 账号模型

新增独立账号密码登录，保留官方 ChatGPT 登录作为既有数据与邀请入口。初始账号密码由一次性服务端配置写入数据库，公开源码与客户端不包含可用的初始密码。团队账号保存在 D1；密码为随机盐的 PBKDF2 哈希，登录会话为随机 token，其摘要保存在数据库。HttpOnly / Secure / SameSite Cookie 不通过 localStorage 保存。

初始管理员、编辑者及只读账号加入同一个共享战术本；若存在站点所有者原有战术本，则复用该战术本，不替换任何已保存的战术。账号清单单独交付给所有者。

## v3.1 核心交互与动效修正

- 拖动使用 requestAnimationFrame 合并指针样本，只更新现有 SVG 节点；松手提交一次，取消还原，不在每个 pointermove 重建球场。
- 球员选中后出现画线 / 删除 / 取消的就近工具条；草稿展示下一段虚线、端点、节点编号、退一步与完成。
- 给已有主路线的球员画线时明确选择主路线或选项；新主路线保留原路线为选项，避免保存后演练仍走旧线。
- 布阵与演练有明确模式、进度、跑动 / 传球阶段和返回入口；暂停、时间轴调整不会重建球员节点。
- 表单修改保留属性面板与输入节点，避免 blur 时重建页面导致下一个点击丢失。
- 工具选中底板使用弹性曲线滑动；战术切换有短过渡与路线描绘；新增防守队员逐个进入，进攻队员保持稳定。
- 弹窗、菜单、选中标记和通知使用短过渡；支持 prefers-reduced-motion。手机保留七个可见工具及浮动完成入口。
- 防守重设会在清除已有防守路线前确认；操作提示提供直接撤销。


## v3.2 粒子、玻璃与动作反馈（2026-10-22）

重新读取 [taste-skill 主技能](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md)、app-screens 与 motion 参考。新版已支持应用界面。使用官方 draw 脚本选择 builder / true-black-flat 方向（seed 1567323215），保留绿色品牌、字体和实际 SVG 球场。用户明确要求粒子、磨玻璃与明显动画，因此覆盖技能默认的平面、无发光、无入场动画限制；其余仍优先明确层级、可读文字及直接操作。

### GitHub 组件调研与选择

| 项目 | 授权 / 集成特点 | 本次决定 |
| --- | --- | --- |
| [tsParticles](https://github.com/tsparticles/tsparticles) | MIT，原生 JavaScript，Slim 可缩减功能 | 集成 Slim 4.4.0，自托管精确版本和许可证 |
| [Motion](https://github.com/motiondivision/motion) | MIT，支持原生 JS 与 SVG，animate mini 约 3.2 kB | 已有 Web Animations API 足够，无需再增加一套动效运行时 |
| [React Bits](https://github.com/DavidHDev/react-bits) / Fluid Glass | MIT + Commons Clause，React / 3D 效果依赖较多 | 不搬入编辑器，保留为视觉参考 |
| [liquid-glass-react](https://github.com/rdev/liquid-glass-react) | MIT，React 控件；Safari / Firefox 折射有已知限制 | 不用其折射实现，选择 CSS 模糊及降级底色 |

官方依据：[高性能动画](https://web.dev/articles/animations-guide)、[backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)、[Canvas 优化](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)、[减少动画偏好](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)、[Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)、[tsParticles 配置](https://particles.js.org/docs/documents/tsParticles_Engine.Options.html)。

### 已实现

- 深绿球场工作台，半透明边缘、18–28 px 背景模糊、内高光与浅色主按钮。菜单有更实的底色，避免文字透叠；实际球场保持不透明。
- 后景流动粒子、桌面鼠标排斥互动、缓慢移动的球场灯光；点击按钮有涟漪，新增球员和完成画线有短粒子反馈。
- 工具和编辑 / 演练模式的滑动底板、440 ms 分区入场、选中提示、逐个球员入场、弹窗 / 菜单短过渡。
- 右上角“视觉效果”可选完整 / 轻量 / 关闭，只存在本设备；跟随系统减少动画设置。页面隐藏时暂停粒子，关闭动效时销毁画布。
- 完整模式最多 90 个背景粒子，手机 42 个，轻量 28 个；绘制像素比为 1，帧率上限分别 60 / 30。上限是配置目标，不代表已在所有设备测得稳定帧率。
- 粒子库按需加载，不依赖第三方 CDN 请求；加载失败保留静态界面。串行初始化和代次检查防止快速切换时产生多个画布。
- 登录、入口页、编辑器、表单、导出与共享管理控件采用相同样式。触控布局保留七个工具和可见的绘制完成入口。

### 验收与范围

通过受管理的 Chromium 预览验证桌面、768 px 平板及 390 px 手机布局（后两者为 iframe 视口，非真机）。实际操作验证 4–3 防守、选中、拖动、画线、完成、演练、重置、导出弹窗与三档动效；修正菜单透字问题。检查登录页展示。新增测试覆盖快速切换、单画布、后台暂停、系统减少动画与存储不可写。

未在 Safari / Firefox 或实体低端手机做性能基准；浏览器日志存在扩展自身的 metadata 错误，没有将其记作应用异常。未使用 taste 的独立浏览器检查器，浏览器验收遵守 Sites 的受管理预览流程。本次不变更服务器认证、共享数据库结构、成员角色或已有密码。


## v3.3 · STINGERS 紫黄主题

按用户提供的 STINGERS 参考图，将品牌主色改为深紫与亮黄：深紫背景 `#140e23`、品牌紫 `#46217a`、黄色强调 `#ffdc42`。主操作用黄色，次操作与面板用半透明紫色，选中、焦点、时间轴与粒子同步配色。错误与警告保留语义颜色。

透明队标用于登录页、侧栏、球队入口与浏览器图标；闪电和星形用于品牌装饰。HYROX 徽章与字样未加入。默认新建进攻球员/路线为黄色、防守球员为淡紫；已保存战术的自定义颜色保持原样。共享数据、角色权限和账号未修改。

沿用完整/轻量/关闭三种视觉效果，并尊重系统减少动画偏好。桌面 1353px 与 390px 窄屏布局已检查。资产来源与处理说明见 `web/assets/README.md`。


## v3.4 · 可调节战术板

移除旧的 `100dvh - 510px` 球场高度上限。默认高度根据窗口大小确定，桌面通常约 580px；手机按可用宽度适配。画板上方提供高度滑块、展开与恢复默认。底部高度拖柄与桌面属性栏分隔条使用 Pointer Events、指针捕获与逐帧更新，支持鼠标、触摸和键盘。

展开模式收起战术列表及属性栏，按全宽放大球场；普通与展开高度分别记忆。Esc 退出展开，绘制草稿与对话框优先处理自己的 Esc。重设与拖动取消均有确定的回退行为。

调整仅修改 CSS 尺寸，不重新创建 SVG、修改球员位置、清空路线草稿或停止演练。SVG 保持 5:4 比例，鼠标坐标映射不受缩放影响。布局单独保存在 `playbook-studio-board-layout-v1`，只读成员也可调整，不进入云端数据和撤销历史。
