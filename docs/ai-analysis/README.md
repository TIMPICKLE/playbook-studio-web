# AI 战术分析与知识库

本分支将 AI 分析扩展为可复核的美式橄榄球对局工作台：图面事实、用户选择的覆盖假设、条件化知识与模型推演分别呈现。

## 阅读入口

| 文档 | 用途 |
| --- | --- |
| [竞品与产品研究](research.md) | 九个竞品、23 个一手来源、适合本项目的产品方向 |
| [知识库技术研究](knowledge-architecture.md) | 图文关联、RAG 分层、模型边界、检索与引用评估 |
| [Task Plan](task-plan.md) | Team A 初稿及独立 Team B 审阅后的执行计划 |
| [产品审阅](review-product.md) / [架构审阅](review-architecture.md) | 开发前的独立挑战与必须修订项 |
| [实施与验收记录](plan-review.md) | 审阅意见如何落地及实际验证边界 |
| [战术验收案例](acceptance-cases.md) | Cover 2 Read、Cover 3 Match、Mesh、保护与未知责任等反例 |
| [PDF 本地预处理](pdf-ingestion.md) | 提取文本、页码、区域和离线预览；扫描件处理边界 |

## 使用方法

1. 从工作台进入 **AI 分析战局**，选择进攻、防守战术和可选球员视角。
2. 未填写 API Key 时，已经可以查看图面对象数量、覆盖假设及真实召回的资料。它们是本地计算与检索，不是模型报告。
3. 确认防守规则：`unknown`、Cover 3 spot、Cover 3 Match、Cover 2 变体未确认、Cover 2 Read 或 man。仅有安全卫站位时保留未确认。
4. 在比赛情境中补充档数、距离、场地区域、已知保护/匹配规则或具体问题；资料关键词可进一步聚焦检索。
5. 展开资料查看适用条件、例外、观察对象与来源。可导入 JSON、Markdown 或 TXT；知识包显示已有的页码、区域和显式图文关联。
6. 连接模型后开始分析。情景中的图面证据可高亮对应对象，知识证据可展开来源。变更战术、情境或知识会使旧报告失效。

知识保存在**当前设备、当前战术本**，可导出备份；目前不随云端战术本同步。每次最多向分析端发送 6 条召回的本地片段，而非整个资料库。API Key 只保存在页面内存中。

## 当前实现

| 能力 | 实际范围 |
| --- | --- |
| 默认知识 | 13 条原创双语摘要，来源为六篇 USA Football 教练文章；每条保留条件、例外与观察对象 |
| 检索 | 双语术语别名、词法相关性、覆盖过滤、显式父链回补；最多 6 条 / 24,000 UTF-8 字节，不显示概率分数 |
| 本地资料 | JSON/Markdown/TXT 导入、合并去重、移除、导出、按战术本隔离；单包上限 1,000,000 字节 / 400 片段 |
| 图文追溯 | `sourceId → page → regionId/bbox`；显式 `parentId/figures`。同页不自动关联所有图 |
| PDF | Python + PyMuPDF 本地提取可选择文字，生成页/区域来源及可选离线 PNG；无文字页标记 `needs_ocr` |
| 云端分析 | 扩展现有 LangGraph 的授权资料检索工具、证据白名单、有限修复及取消；现有模型协议继续支持 |
| 静态演示 | 共用知识检索、几何与引用 ID 校验，单次模型请求；明确保留 limited 状态，不假装运行云端工具 |
| 完整性 | 未知覆盖或宽泛 Cover 2 始终有限；引用合法只验证 ID 存在，不验证结论蕴含关系 |

## 后续扩展边界

自动 OCR、战术图视觉理解、向量检索、重排、球队共享知识持久化和真实比赛追踪模型尚未实现。当前页码或图片路径用于追溯，图片像素没有进入分析模型。下一阶段可从 Docling 解析适配器、按显式关联取图、dense/sparse 检索与小型教练标注评估集开始，详见技术研究。

静态图无法证明真实防守责任、保护分配、同时到达或比赛胜率；本功能用于有条件的战术学习和复核。

## 复现验证

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run typecheck
node --test --test-concurrency=4 tests/*.test.mjs
python scripts/test-ingest-football-knowledge.py
npm run build
```

Python 预处理独立依赖 PyMuPDF；部署和运行 Web 应用不需要安装 Python。Node 测试的低并发选项用于控制整套 DOM/Worker 测试的内存占用，不改变验证范围。
