# 战术板 AI 助手架构与使用边界

画布上的助手由一个 LangGraph Agent 和编辑器共同完成任务。模型决定读取什么、调用哪个工具、如何组织修改提案。编辑器根据提案构造预览，教练确认后再提交一次可撤销的事务。[状态图](../web/assistant-harness.js) · [编辑器接入](../web/app.js)

## 状态图与统一契约

```mermaid
flowchart TD
    M["model · 理解指令与选择工具"] -->|"读取或试算"| T["tools · 返回可核对的证据"]
    T --> M
    M -->|"submit_result"| V["validate · 同源 schema 与证据检查"]
    V -->|"首次失败且有预算"| M
    V -->|"edit"| P["编辑器预览，等待教练应用"]
    V -->|"其他结果"| R["展示候选、回答、澄清或移交"]
    V -->|"再次失败"| F["结束并提示"]
```

结果类型与操作参数统一定义在 [assistant-schema.js](../web/assistant-schema.js)。Zod 定义同时生成模型工具的 JSON schema 和程序校验器。提示词只说明使用方式，最终结果通过 `submit_result` 提交。最后一轮强制选择该工具。服务商明确不支持指定工具时，传输层回退到 JSON 正文，仍使用同一个 schema 和证据校验。

| 工具 | 功能 |
|---|---|
| `read_board` | 提供完整战术快照与场上人员信息，路线带 ID、时序和可选 intent。 |
| `resolve_player` | 根据位置、姓名片段、号码和相对位置定位真实棋子。 |
| `resolve_players` | 批量定位多组条件，位置组可以返回多名球员。 |
| `search_madden` | 按名称、近似几何标签、阵型与球队检索，或按当前战术寻找相似条目。 |
| `preview_edit` | 调用共享提案函数，完整校验整组操作，返回实测深度、折向、阻挡顺序、变更 ID 与摘要。 |
| `submit_result` | 提交 edit、search、answer、clarify 或 handoff。编辑结果必须对应已经试算并查看过的操作组。 |

Agent 试算与编辑器预览均调用 [proposeEdit](../web/assistant-proposal.js)。它校验原战术、运行整组操作，再对结果执行完整 `validatePlay`。同一规范化战术和操作会得到相同的新对象 ID。变更清单复用该函数的几何测量摘要。模型有机会根据工具返回的实际效果修正提案，编辑器负责最终写入、自动保存和一次撤销。

图的状态保存下一节点、模型调用数和修正标志。工具证据与模型消息只存在于本次运行。一次运行最多 6 次模型调用、10 次工具调用，单条消息最多提出 5 个工具调用，执行层依次执行。回复上限为 1,800 tokens，调用前检查对话是否超过 120,000 字节，单次运行最多 90 秒。校验失败且有预算时允许修正一次。[状态图与预算](../web/assistant-harness.js) · [传输适配](../web/assistant-provider.js)

## 意图、跟进与并发

概念路线将 `intent` 随战术保存，包含 concept、depthYards 和可选 breakTo，刷新后仍能通过 `read_board` 查看。手动拖点或平移改形会清理失效意图。旧数据没有 intent 时，模型仍可查看路点，但需要从几何判断或向教练确认。

浮窗在当前工作区和战术内保留最近五条结构化记录，包括已应用与已放弃的提案、操作和涉及的 ID。刷新或切换战术会清空会话记录。放弃后可以接着说“换成 post”。这些记录提供上下文，每次运行仍须通过工具重新确认对象。

提案冲突按涉及的球员、路线、目标和球权等依赖判断。无关标题或其他棋子的修改会在最新战术上重算。应用时如果需要重算，浮窗刷新预览并再次等待确认。引用的对象被删除，或相关对象在等待期间被修改，则拒绝该提案。[冲突判断](../web/assistant-conflicts.js) · [编辑器接入](../web/app.js)

浮窗提供“查看过程”，在当前页面展示工具名、参数、结果摘要和校验错误，不记录 API Key 或模型内部推理。静态版通过回调接收事件，云端通过 NDJSON 接收事件。`handoff` 保留原始指令和可用的防守上下文，进入独立的战局分析功能。

## 支持的指令

先将涉及的球员放在当前战术图中。姓名可用名、姓或全名匹配，号码支持 `12`、`#12` 和 `12号`。多个匹配对象会要求教练澄清。以下示例描述期望的提案，实际调用顺序由模型决定。

| 指令示例 | 期望的预览 |
|---|---|
| “X 跑 12 码 dig，向内折” | 生成概念路线。支持 slant、out、in、dig、curl、comeback、hitch、post、corner、go、fade、seam、flat、wheel、drag 和 screen。 |
| “C 先挡前面的 DT，再挡叫 Avery 的 LB” | 按顺序生成分段阻挡。演练时目标的当前位置用于计算接触点。 |
| “OL 全线向左 zone 阻挡” | 批量定位锋线，一次提议多条阻挡路线。还支持 gap 和 pass protection 方案。 |
| “Z 先向左 jet motion，再跑 flat” | 创建预动和后续路线。已有 motion 可与主路线共存。还支持 orbit、across 和 shift。 |
| “X 向外移动 3 码” | 移动球员并平移其路线。也支持 wide、slot、tight、off 站位。 |
| “传给 Y，2.5 秒出手，3.5 秒到达” | 设置接球人、传球和到达时序，并生成传球路线。 |
| “画左侧 deep third，CB 落到这个区域” | 添加预设防守区域和球员落位路线。支持 deep third、deep half、flat、hook curl、curl flat、middle hole。 |
| “把 X 的主路线延迟 1 秒、持续 3 秒” | 调整已有主路线的时序。 |
| “删掉 X 的主路线” | 移除指定球员的主路线。 |
| “在 X 旁标注外侧释放” | 在球员旁新增文字注释。 |
| “再深两码” | 利用近期上下文提出后续修改。提案仍需核对，并在预览后应用。 |
| “这套谁是第一读？” | 模型可结合画布信息给出回答，并请求高亮已核对的球员或路线。教练应核实回答。 |
| “分析这套战术对上这套防守” | 可跳转至独立的 AI 对位分析入口，在那里选择攻防战术进行分析。 |
| “找一些打 Cover 3 的 Madden 战术” | 检索目录，返回含图例、可编辑状态和简短依据的候选。教练点击后导入。 |
| “找和这套类似的战术” | 按阵型与可编辑路线的近似概念特征排序候选。 |

改图结果先显示半透明预览和变更清单，教练可以预览演练、放弃或应用。应用前重新检查当前战术、权限和请求快照，整组修改进入一次编辑事务。撤销可回滚整组。手机端使用半高底部面板，预览时收起以露出球场。[预览和事务](../web/app.js) · [领域操作](../web/assistant-operations.js)

## 当前限制

- 几何是基于固定开球线 `y=67`、进攻方朝减小的 y 方向和画布比例生成的近似示意，路线和阻挡方案仍需教练检查。阻挡目标被删除后使用保存的路线点。没有目标 ID 的旧路线沿用原有动画。
- Madden 当前目录来自 Eagles 和 Ravens 的进攻战术。可编辑轨迹的标签按几何近似生成，并非经战术教练逐条认证。原图条目只提供名称和阵型等元数据，不提供推测的路线标签。目录缺少人员组、跑传和比赛情境数据，模型检索工具暂不提供这些筛选参数。
- 几何标签仍有漏检。以当前可编辑目录的战术名称作弱标注，FLOOD 命中 17/23、SMASH 命中 9/13、CURL 命中 13/20、VERTICAL 命中 16/18。名称不是逐条真值，这些数字用于检查召回，不能作为准确率。检索分别标明名称标签和近似几何标签，可靠评估还需要教练标注的独立样本。
- 模型推荐的依据和战术问答是辅助判断。图上对象的来源可校验，战术解释的正确性仍取决于模型与所给上下文。
- 相似检索依赖可编辑路线和阵型特征。AI 不会从原图中即时识别完整战术。只有原图的战术仍是参考图，无法按可编辑路线演练。
- 会话只保留当前页面最近五轮。历史记录不会在刷新后恢复，也不能跨战术沿用。静态版需要用户配置 API Key，语音听写依赖浏览器和麦克风权限。

## 宿主与数据

GitHub Pages 在浏览器中加载 LangGraph 浏览器包，并直接调用选择的服务商。云端由 Worker 调用相同的图，使用服务端目录并在请求入口、模型调用前以及结果返回前核对身份、工作区权限和版本。返回编辑提案需要写权限。客户端还会在应用预览时重新检查权限和画布是否变化。[浏览器与云端传输](../web/assistant-provider.js) · [云端处理](../server/api.mjs)

画布快照包含场上球员的姓名、号码、位置以及战术内容。使用时，这些必要信息会按工具调用发送给所选模型服务商。API Key 用于当次模型请求，静态页保存在当前页面内存中。

## 框架选型

项目有两个入口。GitHub Pages 在浏览器中持有本地战术本和用户本次输入的 API Key。云端工作台通过 Worker 鉴权并检查战术本版本。两者需要共用工具名称、输入约束、循环退出条件和最终结果格式。现有对位分析已使用 `@langchain/langgraph`，依赖版本由项目的锁文件固定。

| 方案 | 本场景可以复用的能力 | 接入成本与判断 |
|---|---|---|
| Claude Agent SDK | Claude Code 的工具循环、权限和会话。官方 TypeScript SDK 支持 Node，浏览器 SDK 也提供与远端 CLI 通信的传输接口。 | 采用远端 CLI 需提供运行服务并管理其会话。战术板当前需要的是画布对象和目录查询，以及教练选择的 OpenAI 模型。单独引入该运行环境的收益有限。 |
| Pi agent-core | 可嵌入的工具循环、流式事件、自定义模型传输和停止控制。官方示例也包含浏览器代理传输。 | 可胜任这两个交互。采用 Pi 将另引入一套消息和工具适配层，需要同时维护它和已有对位分析所用的 LangGraph。 |
| LangGraph.js | 状态图、条件边和单次运行的状态。节点可以调用项目自己的模型适配器与领域工具。 | 选用此方案。两套宿主共享图与工具契约，模型可在同一轮指令中读取画布、查找球员或迭代检索目录，再给出操作。 |

框架资料来自 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)、[Claude 浏览器 SDK 更新记录](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)、[Pi agent-core 文档](https://github.com/earendil-works/pi/tree/main/packages/agent) 和 [LangGraph.js](https://github.com/langchain-ai/langgraphjs)。

## 维护与回归

新能力先在 [工具注册表](../web/assistant-tools.js)或[领域操作](../web/assistant-operations.js)中定义可验证的输入与结果，再扩展[图的结果校验](../web/assistant-harness.js)和编辑器事务。增加数据字段时检查 [model.js](../web/model.js) 的校验、保存与旧数据兼容。Madden 几何标签的生成入口在 [脚本](../scripts/build-madden-search-tags.mjs)，路线特征在 [madden-concepts.js](../web/madden-concepts.js)。

更新 LangGraph 依赖后运行 `node scripts/bundle-board-agent.mjs`，提交生成的浏览器包和署名文件。下列测试使用脚本化模型，无需 API Key。

```sh
node --test tests/assistant-*.test.mjs tests/board-assistant-ui.test.mjs
```

## 真实模型评测

[评测集与说明](../evals/board-assistant/README.md)包含 50 条中英文用例，覆盖编辑操作、歧义、跟进、检索与问答。每条设置结果类型和关键断言。使用真实模型运行时记录通过率、模型与工具调用数、修正次数和耗时。

```sh
node scripts/eval-board-assistant.mjs --list
# 先在环境中设置 BOARD_ASSISTANT_API_KEY
node scripts/eval-board-assistant.mjs --run --model gpt-6.1-terra --concurrency 3 --out /tmp/board-evaluation.json
```

默认只列出用例。`--run` 才调用模型。提示词、工具描述或默认模型变更后应重跑该集合，并保留失败项。脚本化测试检查框架行为，真实模型结果用于衡量指令理解能力。
