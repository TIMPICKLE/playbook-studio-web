# AI 战术分析 · 计划审阅与实现核对

日期：2026-11-15。研究基线：`1ddb37a`；功能分支：`feature/grounded-ai-analysis`。

## 团队流程与决定

Team A 先并行完成竞品/产品、多模态知识架构和仓库现状调查，形成 [task-plan.md](./task-plan.md)。Team B 在实现前分别作 [产品与战术审阅](./review-product.md) 和 [架构与可靠性审阅](./review-architecture.md)，结论均为“修订后实施”。八项关键修订已纳入 Task Plan，再进入本分支开发。

Team B 在实现后再次阅读当前 UI、知识检索、存储、云端构建、模型流程及测试。**本轮代码核对未发现新的 P0 产品阻断问题。** 这表示计划中的核心程序契约已有对应实现，不表示已经验证真实模型的战术判断，也不代替浏览器视觉验收。

## 审阅要求 → 实现 → 证据

| 已采纳修订 | 当前观察到的实现 | 自动验证入口 |
| --- | --- | --- |
| 区分宽泛 Cover 2 与 Read | `ANALYSIS_COVERAGES`、前端选择器和 API 接受 `cover2_read`；`cover2` 标为变体未确认，维持 limited；规则检索按显式 coverage 过滤 | `tests/knowledge-base.test.mjs` 的 coverage 过滤；`tests/matchup-knowledge.test.mjs` 的 Read 一致性；`tests/knowledge-ui.test.mjs` 的无 Key 操作 |
| 无 Key 提供真实价值，不伪装模型完成 | `localBriefHTML()` 从当前图面计算人数、接应路线和区域数；知识卡由实际本地检索返回；模型情景保留独立空状态和明确触发按钮 | `tests/knowledge-ui.test.mjs`：无 Key 有事实和资料、无模型请求、无情景报告 |
| 引用存在与推论成立分开 | 证据 ID 只来自当前图面和召回资料；返回 `citationIdsVerified: true`、`entailmentVerified: false`；来源详情明确原则仍需核查适用条件 | `tests/matchup-knowledge.test.mjs`、`tests/matchup-agent.test.mjs`、`tests/ai-demo.test.mjs` |
| 通用知识不能把信息不足升级成完整 | unknown 与宽泛 cover2 独立触发 limited；模型情景引用不足、缺图面或缺失信息也保留 limited；不会以命中卡片数量作为成功概率 | `tests/matchup-knowledge.test.mjs`：unknown + 资料命中 + 表面完整 JSON 仍 limited |
| 预设与用户资料身份隔离 | 导入来源统一归为 team；内置命名空间保留；来源内容指纹、重复去重与同 ID 冲突检查均存在 | `tests/knowledge-base.test.mjs`：身份冒充、稳定指纹、幂等合并和冲突拒绝 |
| 多层预算与明确发送范围 | 文件 1 MB；本地来源/卡片数量和内容字段有界；召回最多 6 卡、24 KB；分析知识包另限 6 卡、32 KB；HTTP 请求及模型上下文另行检查 | `tests/knowledge-base.test.mjs`、`tests/matchup-knowledge.test.mjs`；`web/analysis-evidence.js`、`server/api.mjs` |
| 工具仅访问本次授权资料 | 云端保留强制读取对局的 LangGraph；新增检索工具只在本次已召回片段内查找；静态演示共用检索与引用白名单，仍明示单次请求 | `tests/matchup-knowledge.test.mjs`：工具范围与浏览器/云端证据 ID、几何一致性 |
| 图文保持显式关系，禁止同页自动绑定 | 校验保留 source/page/region/bbox/figures；父卡片仅限同来源、无循环、预算内原子回补；PDF 预处理器不猜测图文语义关联 | `tests/knowledge-base.test.mjs`：同页多图、父关系和预算；`scripts/test-ingest-football-knowledge.py` |
| 本地存储范围诚实、失败可见 | UI 标注“此设备 / 当前战术本”；保存成功才采用新知识包；读取失败、损坏和容量失败均有提示；不会改写云端工作区结构 | `tests/knowledge-ui.test.mjs`：存储失败、损坏和跨战术本隔离 |
| 导入、删除、切换不留下旧报告 | 导入捕获 workspace ID 与 generation；关闭、切换和删除使旧任务失效；资料变化先取消并清除旧报告，来源检查面板随结果重建被移除 | `tests/knowledge-ui.test.mjs`：延迟导入、关闭、切换和删除；`tests/matchup-ui.test.mjs` 的迟到请求与取消 |
| 保留原编辑/模型协议行为 | 原有图面证据 ID、镜像、模型提供商适配、有限修复、revision 与权限复核继续使用；本轮不做自动改图或云端资料迁移 | 原有 matchup API/agent/UI/Worker、provider 和全量回归测试 |

## 范围与明确保留的边界

- 当前知识库为可解释的词法、双语别名与领域标签检索；未将它标为已经实现的向量语义检索。
- 当前 PDF 接入是**本地可选中文本预处理**：来源摘要、页码、文本 bbox、实际嵌入图片位置和可选预览可追溯。扫描页标为需要 OCR，不生成虚构文本。预览 PNG 不会随 JSON 自动发送模型。
- 图像引用用于出处关联，当前分析未发送图片像素；没有宣称完成 OCR、图形视觉理解或视频责任识别。
- 本地事实只计算真实图示对象；阻挡线不直接等同于保护人数，静态交叠不直接等同于空位或同时到达。
- 所有模型建议仍是条件推演。程序只校验引用 ID 和协议，不自动证明来源与每个自然语言结论之间的语义蕴含。
- 自动修改路线、3D 教学、比赛影片跟踪、共享云端知识库和基于真实历史数据的预测，均未被混入本次已完成能力。

## 验证记录与限制

大包性能复查使用约 788 KB、350 条片段的合法知识包。首次实现每次检索都会重做校验、指纹与词项索引，重复查询约 100–300 ms。已改为只缓存本模块验证并深度冻结的对象，使用弱引用索引；同一环境复测首次建索引约 27 ms、重复检索约 1.7–3.0 ms，内置资料约 0.2–0.3 ms。原始可变对象仍完整校验，不以外部 `Object.freeze()` 代替信任。行为测试覆盖可变输入失效、冻结与结果一致性，并在独立进程验证弱引用可被垃圾回收。以上是本机工程测量，不是跨设备性能承诺。

最终提交前已复核：438 项 JavaScript 测试全部通过（`node --test --test-concurrency=4 tests/*.test.mjs`），以及 `npm run check`、`npm run typecheck`、`npm run build` 通过。最后一次完整回归包含不可变知识索引缓存及通用知识不能升级完整性的修复。

PDF 预处理器已独立运行 `python scripts/test-ingest-football-knowledge.py`，4 项离线行为测试全部通过。JavaScript 测试不代替该 Python 检查；两者分别验证浏览器/Worker 与本地资料处理路径。

本轮浏览器预览基础设施出现 CUA 超时，无法完成真实截图、视觉排版、键盘焦点与触屏的最终验收。源码中已设置桌面/手机断点、减少动画选项及交互语义，DOM 行为有测试覆盖；这些不能替代真实浏览器观感验证。没有因预览超时伪造截图或声称完成视觉验收。

没有真实 API 凭证与教练复核记录时，真实 provider 的 F01–F12 战术回答质量维持**未验证**。模拟响应测试验证流程和引用契约，不能作为模型准确率或实战有效性的依据。后续实际模型/教练验收方法见 [acceptance-cases.md](./acceptance-cases.md)。

## 最终审阅结论

本分支已经把 Team B 的关键修订落实到实现与可检查的测试边界，可作为独立功能分支交付审阅。对用户应准确描述为“有来源的战术分析与本地知识工作台”，并保留上述真实模型、视觉验收和扫描资料处理的实际边界。
