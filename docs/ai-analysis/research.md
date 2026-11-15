# AI 战术分析研究：从战术图到有依据的教练判断

研究日期：2026-11-15。研究对象：American football（美式橄榄球），以 11 人制战术设计和攻防对局学习为中心。仓库研究基线：`main@1ddb37adc8a29a005647c555bc1e339f0f8b6005`。

本文记录本轮产品研究与方案选择的依据，不把建议中的路线图写成已经实现的功能。执行计划见 [task-plan.md](./task-plan.md)，独立审阅与最终实施边界以对应交付记录为准。

## 结论概览

1. 最适合当前项目的方向是**针对用户自己的攻防战术图，提供条件明确、来源可查的对局学习工作台**。录像自动标注、战术搜索、静态战术图分析是不同任务，不能共用一个含糊的“AI 分析”承诺。
2. “大模型 + 战术知识库 + 用户 playbook”已是直接竞品的公开能力。差异应来自图面事实、战术假设、教练规则、反例和修改建议之间的可复核关系，而非增加一个聊天入口。
3. 知识库适合补充战术原理与条件，程序负责抽取图上的球员、路线、区域和空间关系；二者共同支持模型解释。检索命中不意味着结论成立，来源可靠也不意味着来源适用于当前对局。
4. 最关键的专业边界是：**站位不是责任、前线阵型不是覆盖、几何相交不是同时到达、战术名称不是设计被正确执行的证据**。静态图不能提供经校准的推进码数、完成率或胜率。
5. 本轮宜先打通精选知识、本地资料导入、条件化检索、引用验证和真实分析界面，再逐步接入更完整的 PDF 图文理解、向量检索、重排序与真实比赛数据。每一阶段都要明确实际支持的输入。

## 研究方法与证据等级

本次优先使用厂商官方产品页、帮助中心、USA Football 的署名教练文章，以及 NFL/AWS 的公开技术说明。下表中的“公开能力”指来源页面明确描述的功能，不代表本研究通过付费账号实际验收，也不代表独立验证其准确率。没有可复现基准的预测、时间节省和营销数字，不用作本项目的性能承诺。

对动态网页保留检索限制：某些产品页的搜索索引可读，但直接打开只返回 JavaScript 占位；这些来源只能支持有限的厂商自述，不与完整帮助文档同等对待。调研日之后产品仍可能变化，文末保留原始 URL 供复核。

## 九个相关产品：直接竞争与相邻工作流

| 产品 | 官方公开能力与证据 | 竞争关系 | 对本项目的启示及限制 |
| --- | --- | --- | --- |
| Hudl Assist / Assist+ | 把视频标签、球队及个人统计、报告和球员 playlist 关联起来。FAQ 明确说明，多数项目的核心仍依赖受训分析员；Balltime AI 的说明针对排球。[S01] | 相邻：视频拆解服务 | 借鉴结论回到原始证据的体验。不能把“automated breakdown”直接理解为美式橄榄球全自动 AI 战术推理。 |
| Hudl IQ | AI、计算机视觉与专业数据采集结合，公开描述阵型、路线、覆盖、突袭分类，以及 QB、WR、OL 等位置分析。[S02] | 强相邻：真实比赛数据分析 | 借鉴位置组和情境视角。其输入和模型基础与用户画出的静态路线不同，不能移植完成概率等数字来装饰当前分析。 |
| FirstDown PlayBook AI Play Finder | 2026-02-03 的发布文章介绍自然语言查找可编辑战术图，并继续扩大或收窄搜索范围。[S03] | 直接：战术检索 | 检索结果应回到真实、可编辑的候选。文章中的大规模战术数量是厂商描述，不是本项目已经拥有的资料规模。 |
| Pro Quick Draw | 战术绘制、playbook、scout card、install presentation、cutup 和视频数据集成；帮助中心说明可自定义 shapes、routes、formations。[S04][S05] | 相邻：教练备战工作流 | 分析结果必须进入现有备战与编辑流程。本研究未找到足以证明其具有通用“攻防 AI 推理”的一手证据，不据此扩大其能力。 |
| GoArmy Edge Football | 绘制路线、交接和 motion；实时 3D 与球员视角；以 formations、reads、keys、coverages、blitzes 制作训练和测验。[S06][S07] | 相邻：教学与视觉复习 | 输出应回答球员观察谁、何时决策、如何练习。动画呈现设计意图，并不证明对抗结果准确。 |
| Modern Football Technology | 实时 self-scout、对手倾向、情境统计、触屏录入及跨视频平台数据流程；官方页面强调比赛中的调整。[S08][S09] | 相邻：比赛数据与决策支持 | 真正的倾向判断依赖实际样本及情境记录。不能把“实时”或节约工时的宣传转化为没有数据支持的预测。 |
| XO Gridmaker / Coach Cal | FAQ 描述精选美式橄榄球知识库、真实 playbook scope、结构化战术生成、缺口分析、防守应对和练习计划，并按年龄及比赛人数调整。[S10] | 最直接：知识库与战术编辑 AI | “接入 RAG”本身不足以差异化。应提高引用、适用条件、未知信息、图上定位和教练审核的可见性。原 PlayGrid FAQ 会跳转到 XO Gridmaker。 |
| PlayAction AI | 产品页描述输入 tracking、charting、playbook，训练定制模型，输出 scouting、game plan、模拟及 MCP 接入。[S11][S12] | 高阶相邻：数据模型与模拟 | 必须先说明需要什么数据。公开方法页不足以让本研究复现其 football 预测准确率，不能以其营销描述为实证结果。 |
| Prospex | 官方搜索索引描述影片标注、split tagging，以及基于标签的 AI coaching assistant；直接打开页面仅见 JS 占位和联系入口。[S13] | 新兴相邻：影片任务助手 | 可参考任务导向的交互，如按第三档和阵型整理录像。能力证据较弱，本轮不据此声称其已解决可验证的战术推演。 |

由这些产品可以辨认出三类用户工作：第一类把比赛变成可检索数据；第二类把战术变成可编辑资产；第三类根据球队资料组织教练决策。当前仓库已经以战术图和攻防选择为入口，更合理的投入是连接第二类与第三类。重建视频追踪平台需要完全不同的数据、标注、训练和部署体系，不宜作为当前分析升级的隐含前提。

## 推荐定位与产品判断

推荐的核心任务是：**教练选择一套进攻和一套防守，补充比赛情境，检查关键空间冲突、读取对象、执行条件与双方调整，并能看到判断用了哪些资料。**

这比“预测哪套战术赢”更适合当前输入。战术图描述的是意图，通常没有真实跑速、步法、出手时刻、保护交接、判罚、身体对抗与对方临场调整。软件可以发现需要检查的设计问题、提供结构化学习线索，但不能把这些缺失输入隐藏在一个确定分数后面。

建议让每项结论分别显示四层内容：

| 层次 | 示例 | 谁负责生成或确认 |
| --- | --- | --- |
| 图面事实 | 同侧存在一条短路线与一条更深的外切路线 | 程序读取真实球员 ID、路径和坐标；保留抽取限制 |
| 对局假设 | 本次按 Cover 3 spot-drop 分析，未确认 match 规则 | 用户声明或明确标记的分析假设 |
| 教练原则 | 利用不同深度对 curl/flat 责任制造选择压力 | 有来源、适用条件和反例的知识条目 |
| 行动建议 | 观察 curl/flat 的扩张或下沉，再检查保护是否允许路线展开 | 模型结合事实、假设和资料推导，允许用户复核 |

图上“看到了什么”和教练“通常怎么处理”应在界面上相邻，但不能混成同一种证据。一个有引用的原则仍可能不适用于这套路线；一组几何关系也不能自行证明真实球员将按预想时序到达。

## 专业反例：为什么知识库不能只是克制表

### Cover 2：spot 与 Read 不能共用确定结论

基础教学会把 Smash、深中区等列作传统 Cover 2 的常见攻击方向。[S14] 但是 USA Football 的 Cover 2 Read 教练文章明确描述，通过角卫的规则与技术，可以应对通常攻击 Cover 2 的 Smash、fade-flat 等组合。[S15]

产品推论：如果只检索到“Smash 克制 Cover 2”，模型可能给出专业措辞漂亮但前提错误的建议。知识条目必须带 `coverageRules`、适用条件与例外。用户只提供双高站位时，应把规则记为未知，而不是自动选一个有利于进攻的解释。即使用户填写 Cover 2，也要避免默认它必然采用同一套角卫技术。

### Cover 3：spot-drop、match 与 trips 检查会改变答案

USA Football 对 Andy Reid 的 four-strong 组合分析，明确区分 spot-drop Cover 3，以及为处理 trips/flood 而推移 underneath 责任的 Mable/Skate 类检查。[S16] 相同的“三深”标签，并不能完整描述下方责任如何分配。

Hank 教学进一步以具体路线深度、QB drop、hook defender 是否 squeeze、curl/flat 是否扩张来说明读取过程。[S17] Spacing 的分析也建立在 underneath 人数和区域关系上，而非只依赖名称。[S18]

产品推论：检索应同时召回进攻原则与对应防守调整，不能只召回支持推荐的段落。分析需要说明“在采用哪组责任规则时，此窗口可能出现”，并列出必须继续确认的 read key。规则未知时，可以提供分支式教学，而不能把一个假设写成已发生的结果。

### Mesh：概念名称不能替代 leverage、帮助者与压力

USA Football 对 Ohio State 的 Mesh 案例将效果与 man coverage、追防 leverage、low-hole 帮助者缺失和压力联系起来。[S19] 另一个 North Central College 的 Mesh 教学同时包含应对 pressure 的 hot look 和面对特定 coverage 的替代读法。[S20]

产品推论：模型不应看到两条交叉路径就输出“一定跑空”。需要检查路径是否真实交叉、设计深度与间隔、是否只是无时序的几何相交，并承认图中未提供的对抗和责任信息。观察到 crossing，只能支持“值得检查 man-beater 条件”，不能支持已经完成 matchup 结果预测。

这些反例应进入测试集。只测试“Flood 对 Cover 3”这类正例，会鼓励系统背诵标签；加入同标签不同规则、信息不足、保护未知和路线缺失，才能验证系统是否真正尊重条件。

## 技术研究的边界：真实追踪、静态图与足球论文

NFL/AWS 的 Coverage Responsibility 工程采用时空关系建模，处理逐帧防守责任与 matchup，输入包含真实追踪数据及标注。文章也讨论责任交接、伪装与标注噪声。[S21] 这说明“最近的防守人就是责任人”并不充分，也说明实战责任识别与静态设计图分析的输入条件有根本差异。

对当前项目的工程推论是：可以在结构化图上计算站位、路线形状和区域交叠；若要推断实战责任、出手窗口或结果概率，需要另行定义数据、训练标签和评估方法。增加一个通用大模型并不能补齐这些输入。

DeepMind 的 TacticAI 是与 Liverpool FC 合作的**协会足球角球**研究，结合检索、预测、生成建议和专家评估。[S22][S23] 它可以启发我们把“找相似案例”“形成建议”“验证建议”分开，但不能作为美式橄榄球模型有效的依据，也不能搬用其专家偏好结果作为本项目准确率。本文没有将 soccer 或 rugby 产品混入美式橄榄球竞品表。

## 知识内容的组织决策

知识库的基本单元应是“带条件的教练原则”，而非固定长度文本片段。建议包含以下信息，具体存储契约以架构文档与实现为准。

| 信息 | 用途 |
| --- | --- |
| `sport`、`variant`、水平与规则范围 | 避免把 flag、7v7、11v11 或不同年龄建议混用 |
| 概念、同义词和双语别名 | 同时检索 Flood、Sail、泛称及中文描述，避免只靠英文精确匹配 |
| 适用条件与反例 | 识别 spot、Read、match、pressure 等会改变结论的条件 |
| 观察对象和教练提示 | 从解释转为球员能够练习的 read key 与执行提示 |
| 稳定来源 ID、页码与图区 ID | 从文本命中回到原始页面、图注及相关战术图 |
| 原文事实、摘录与编辑说明的区别 | 防止把模型自动生成的解释误当成原始资料 |
| 审阅状态和更新时间 | 允许后续修订、替换和废弃错误条目 |

对于 PDF 和图片，保留 `document → page → region/figure → chunk` 的关联比简单把图和文本分别扔进索引更重要。文本命中后可按关联关系带回图注、图区与上下文；图命中后也应找到说明文字。关联存在不代表已经做过图像语义理解，扫描件需要 OCR、视觉理解或人工说明，必须在导入状态中区分。

第一版可使用解释清楚的词法、别名和标签检索，保留可替换接口。它能建立真实的证据闭环，却不能被宣传为已经具备完整向量语义检索、多模态嵌入和重排序。选择检索方案应以反例召回与来源完整性评估，而非因为某个技术名字更流行。

## 建议的工程路线与完成标准

| 阶段 | 工作重点 | 应交付的可检查结果 |
| --- | --- | --- |
| 第一阶段：可信输入 | 读取当前授权的攻防图、真实球员 ID、路线和情境；分析绑定快照 | 缺图、缺路线、coverage 未知时保留缺失信息；切换对局后旧请求不会覆盖新结果 |
| 第二阶段：知识闭环 | 精选条件化知识、来源身份、限定数量的检索结果、资料导入 | 能从命中条目看到来源；无命中时诚实说明；关联图文仍保持同页、同来源关系 |
| 第三阶段：分析融合 | 扩展现有 LangGraph 流程，将图面与知识证据一起交给模型，校验引用 | 不存在的球员或来源 ID 不能成为有效引用；通用规则命中不能使信息不足自动变为完整 |
| 第四阶段：工作台体验 | 画布旁展示观察、假设、依据、未知与双方调整 | 不读长篇聊天也能理解主要判断；手机、键盘及 reduced-motion 可用；状态和失败路径清楚 |
| 第五阶段：更完整的图文 RAG | 基于实际资料接入解析、OCR、视觉描述、向量及重排序 | 在包含图文、扫描件、重复来源和反例的固定集上测召回、关联与引用，不仅检查“有答案” |
| 后续独立方向：比赛数据 | 导入逐次比赛样本、人员和情境；再考虑倾向或预测模型 | 所有比例有分母、时间窗和适用范围；没有真实样本不展示实证概率 |

界面建议沿用项目已有的中性银灰与清晰攻防色，信息密度围绕读图任务组织。把重要的两三个判断放在前面，细节与来源按需展开；动效只帮助定位球员、理解状态与切换内容。分析中的修改建议若进入编辑器，应绑定具体目标并保留预览和撤销，避免“文字一结束，整张战术图突然被覆写”。

本轮优先级不应被完整模拟器、影片追踪、任意 PDF 自动理解分散。它们都可能有价值，但必须作为独立可验证能力逐步加入。先做到用户能判断一次建议为什么成立、哪里还未知，比增加未经校准的评分更有长期价值。

## 验证方式：从“能回答”转到“值得信任”

建议按四个层面验收，每层都留下可复现样例：

- **输入一致性**：真实球员、坐标、战术快照和情境是否进入分析；路线变更是否改变相关事实；切换战术本是否隔离本地资料与异步结果。
- **检索质量**：正例与关键反例是否同时可召回；无关或不适用资料是否被过滤；文本、图注、页码和图区关联是否保留。
- **推理约束**：来源 ID 是否属于本次证据集合；是否混淆 shell 与 coverage；是否把用户没有提供的保护、速度、责任或规则写成事实。
- **教练可用性**：能否指出具体 read key、执行条件和防守反制；用户能否查看证据并找到相关球员；解释是否足够短且不隐藏限制。

固定反例至少应包含：Smash vs Cover 2 Read、Flood vs Cover 3 match/检查规则未知、Mesh 有/无 low-hole 帮助、仅有站位而无责任、压力与保护未知、空路线、重复或冲突来源、错误引用、用户资料无命中、同页图文回跳以及跨战术本资料隔离。只有相关测试与实际模型请求都通过的范围，才写入功能已验证声明；没有凭证验证的 provider 应明确列出。

## 一手来源目录

以下均于 2026-11-15 本轮研究检索。教练文章代表署名作者在文中情境下的教学实践，不是对所有规则和球队的普适证明。

| 编号 | 原始来源 | 本文使用范围 |
| --- | --- | --- |
| S01 | [Hudl Assist FAQ][S01] | 人工与 AI 边界、统计和视频关联 |
| S02 | [Hudl IQ][S02] | 官方描述的追踪、分类与位置分析 |
| S03 | [FirstDown PlayBook Introduces AI Play Finder，2026-02-03][S03] | 自然语言查找可编辑战术 |
| S04 | [Pro Quick Draw][S04] | 备战、cutup 与集成工作流 |
| S05 | [Pro Quick Draw Play Editor Overview][S05] | 结构化绘制资产与定制能力 |
| S06 | [GoArmy Edge Football][S06] | 绘制、3D、reads/keys 训练；动态页内容来自官方搜索索引 |
| S07 | [GoArmy Edge Football，Apple App Store 开发者介绍][S07] | 球员视角、formation/RPO 示例和复习训练 |
| S08 | [Modern Football][S08] | 官方实时统计与 self-scout 描述 |
| S09 | [Modern Football In-Game][S09] | 情境记录、录入与比赛调整工作流 |
| S10 | [XO Gridmaker FAQ / Coach Cal][S10] | 知识库、playbook scope、生成与练习能力 |
| S11 | [PlayAction AI Product][S11] | 所需输入与官方产品描述 |
| S12 | [PlayAction AI Research & Methodology][S12] | 方法页面的公开范围，未据此验证预测准确率 |
| S13 | [Prospex][S13] | 官方搜索索引与直接网页的可读性限制 |
| S14 | [USA Football：Teach your quarterback how to read defenses][S14] | 基础 coverage 教学与常见攻击方向 |
| S15 | [USA Football：Eliminate Big Plays with Cover 2 Read][S15] | Cover 2 Read 对常见概念的例外 |
| S16 | [USA Football：How Andy Reid is Stressing Defenses with a 4 Strong Passing Concept][S16] | Cover 3 spot 与 Mable/Skate 类调整 |
| S17 | [USA Football：Teaching the Quarterback to read Hank][S17] | 深度、drop、hook/curl-flat 读取 |
| S18 | [USA Football：Detailing the Spacing Concept][S18] | underneath 数量与空间前提 |
| S19 | [USA Football：Learning from the Buckeyes: Defeating man coverage with mesh][S19] | leverage、帮助者与压力条件 |
| S20 | [USA Football：Play of the Day — Mesh from North Central College][S20] | Mesh 的 hot look 和替代读法 |
| S21 | [AWS：Reading the defense: How the NFL and AWS quantify coverage responsibility，2025-09-25][S21] | 逐帧责任、时空建模、追踪输入与标注限制 |
| S22 | [DeepMind：TacticAI: an AI assistant for football tactics][S22] | 方法论参考；对象为协会足球角球 |
| S23 | [Nature Communications：TacticAI，2024-03-19][S23] | 检索、预测、生成、专家评估的研究分工；不作美式橄榄球有效性证据 |

[S01]: https://www.hudl.com/products/assist/faq
[S02]: https://www.hudl.com/products/football-iq
[S03]: https://firstdown.playbooktech.com/coaches-community/firstdown-playbook-introduces-ai-play-finder
[S04]: https://www.proquickdraw.com/
[S05]: https://help.proquickdraw.com/helpcenter/play-editor-overview
[S06]: https://www.goarmyedge.com/football
[S07]: https://apps.apple.com/us/app/goarmy-edge-football/id968154309
[S08]: https://www.modernfootball.com/
[S09]: https://www.modernfootball.com/in-game
[S10]: https://www.xogridmaker.com/faq
[S11]: https://www.playaction.ai/product
[S12]: https://www.playaction.ai/research
[S13]: https://prospex.cc/
[S14]: https://blogs.usafootball.com/blog/730/teach-your-quarterback-how-to-read-defenses
[S15]: https://blogs.usafootball.com/blog/7073/eliminate-big-plays-with-cover-2-read
[S16]: https://blogs.usafootball.com/blog/7594/how-
[S17]: https://blogs.usafootball.com/blog/7736/teaching-the-quarterback-to-read-hank
[S18]: https://blogs.usafootball.com/blog/7510/detailing-the-spacing-concept
[S19]: https://blogs.usafootball.com/blog/6846/learning-from-the-buckeyes-defeating-man-coverage-with-mesh
[S20]: https://blogs.usafootball.com/blog/7735/play-of-the-day-mesh-from-north-central-college
[S21]: https://aws.amazon.com/blogs/media/reading-the-defense-how-the-nfl-and-aws-quantify-coverage-responsibility/
[S22]: https://deepmind.google/blog/tacticai-ai-assistant-for-football-tactics/
[S23]: https://www.nature.com/articles/s41467-024-45965-x
