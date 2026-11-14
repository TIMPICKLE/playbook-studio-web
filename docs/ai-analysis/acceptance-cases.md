# AI 战术分析验收场景

日期：2026-11-15。适用对象：美式橄榄球静态战术图分析与条件化知识检索。研究依据见 [research.md](./research.md)。

本文把可自动检查的程序行为，与必须通过真实模型和教练复核的回答质量分开。**通过模拟 provider、JSON 校验和检索测试，不代表真实 LLM 已经具备可靠的战术判断能力。** 本文提供验收要求；具体执行结果以该分支最终验证记录为准。

## 十二个战术场景

以下“选择 coverage”均指用户选定的分析假设，不代表软件已从录像识别真实覆盖。测试时先在两套战术中准备表内结构，保留修改前后快照；英文界面重复检查关键来源和限制。

| ID | 输入与操作 | 必须出现的行为 | 必须避免的结论 | 验证层次 |
| --- | --- | --- | --- | --- |
| F01 | 防守画出双高 safety，覆盖选“未知”；进攻使用短、深两层组合 | 保留覆盖与检查规则未知；可展示条件性资料；先说明图上事实 | 自动识别为 Cover 2；自动分配角卫守 flat；引用命中后宣告结论完整 | 图面事实、检索状态、真实模型回答 |
| F02 | 覆盖选宽泛 Cover 2，进攻画出 Smash；未给角卫技术 | 提醒需要区分普通落位与 Read；召回 Cover 2 Read 反例；说明有关 read key 的前提 | “Smash 一定破解 Cover 2”；由双高或名称恢复逐人责任 | 反例召回、事实不足状态、真实模型回答 |
| F03 | 使用同一套 Smash，覆盖明确改选 Cover 2 Read | 覆盖值在 UI、校验、检索和服务端一致；保留 Read 相关资料；对释放、角卫和 safety 规则作条件说明 | 导入或请求报不支持；静默降级为未知；继续使用普通 Cover 2 的确定 flat/high-low 答案 | 类型一致性、检索、真实模型回答 |
| F04 | 覆盖选 Cover 3 spot-drop，进攻同侧实际画出 Flood 的不同层次 | 分析已画出的路线和相关 defender；知识原则说明三层结构及防守移动条件；来源可打开 | 仅凭战术标题宣布三层齐全；给出经校准的完成率或推进码数 | 路线事实、检索、真实模型回答 |
| F05 | 保持 F04 路线，覆盖切换为 Cover 3 Match，不提供球队的 carry/exchange 规则 | 召回 Match 责任/交接说明；将未知安装规则列出；重算分析而非复用旧报告 | 原封不动复用 spot-drop 窗口与固定责任；把区域图当作真实 matchup | 覆盖筛选、请求失效、真实模型回答 |
| F06 | Post/Wheel/Out/Flat 四强侧；上下文分别输入“未确认 trips check”和“按 Mable/Skate 讨论” | 将特定强侧检查作为条件或实例；区分谁可能携带 Wheel、谁扩展及谁提供弱侧帮助；记录尚未给出的规则 | 把所有 Cover 3 Match 都称为 Mable；四名接应自动等于自由接球手；无资料仍写出确定交接 | 条件与来源一致性、真实模型回答 |
| F07 | Man 假设下画 Mesh；两次分别输入“低洞协防未知”和“有 low-hole 帮助者”，其他不变 | 召回 Mesh 的帮助者及追防位置条件；第二次关注协防可能切断 crossing；保留实际时序未知 | 两条线相交就证明跑空；确认帮防存在后仍宣称中央无人 | 反例召回、上下文敏感性、真实模型回答 |
| F08 | 两条 crossing 路线在画布交叉；未给跑速和到达时刻，改变演示播放速度 | 图面可记录交点；说明动画速度不是实战时间；可把间距与时序列作训练检查项 | 宣称两人必在同一时刻相遇；根据演示速度计算掩护效果、冲撞或必然分离 | 静态事实、演示语义、真实模型回答 |
| F09 | 防守呈现多人压线，上下文写“simulated pressure，实际 rush/drop 人员未知” | 将压迫外观、实际冲传和后场责任分开；召回 simulated-pressure 原则 | 压线人数等于冲传人数；前线少一人就证明后方空区；把 4–3 前线直接判为某 coverage | 原则召回、输入限制、真实模型回答 |
| F10 | 一名 OL 画两段 block；RB 没有 block 线；保护 scheme 未提供 | 事实只报告阻挡线数量，说明人数与指派仍需确认；如讨论压力则保留保护条件 | 两条 block 线等于两名保护者；从没有线判 RB 必定释放；计算确定 sack 时间 | 计数语义、保护约束、真实模型回答 |
| F11 | Cover 3 spot 下画 Hank/Hook-Flat；分别说明 hook defender squeeze 或扩张；随后删除 flat 路线但保留标题 | 检索 Hank 原则；把读取顺序与球队安装和 defender 反应联系；删路线后指出组合不足 | 仅凭标题继续声称图中存在 flat；把本文教练来源的一套 progression 当作所有球队唯一规则 | 事实与标题隔离、上下文变化、真实模型回答 |
| F12 | 同一套 Spacing 依次采用 Cover 3 spot 和宽泛 Cover 2；保持路线不变 | 检索随覆盖调整；Cover 2 关注不同下层分配并保留变体未知；对人数只作图面描述 | “Spacing 普遍破解所有 zone”；重复 Cover 3 原文而忽略用户更改；用人数推算实证成功率 | 检索过滤、状态、真实模型回答 |

## 可执行的词法检索与事实检查

在仓库根目录运行以下代码。它检查知识身份、覆盖筛选、来源和未知状态，**不调用真实模型，也不证明这些卡片已经满足具体战术的全部适用条件**。稳定卡片 ID 是当前精选知识集的一部分，若有意拆分卡片，应同步更新这里的验收映射。

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { retrieveKnowledge } from './web/knowledge-base.js';
import { diagramFacts, ANALYSIS_COVERAGES } from './web/analysis-evidence.js';
import { starterWorkspace } from './web/model.js';

assert.ok(ANALYSIS_COVERAGES.includes('cover2_read'));
const cases = [
  ['F01', 'unknown', 'Smash Cover 2 Read corner', 'cover2.read'],
  ['F02', 'cover2', 'Smash Cover 2 Read corner', 'cover2.variant'],
  ['F03', 'cover2_read', 'Smash Fade Flat Read', 'cover2.read'],
  ['F04', 'cover3_spot', 'Four Strong Flood Wheel Out Flat', 'fourstrong.flood'],
  ['F05', 'cover3_match', 'Cover 3 match release assignment', 'cover3.match'],
  ['F07', 'man', 'Mesh crossing low-hole help', 'mesh.man'],
  ['F08', 'unknown', 'Mesh crossing spacing timing', 'mesh.traffic'],
  ['F09', 'unknown', 'simulated pressure blitz protection', 'pressure.coverage'],
  ['F11', 'cover3_spot', 'Hank progression Hook Flat', 'hank.progression'],
  ['F12', 'cover2', 'Spacing underneath flat', 'spacing.cover2'],
];

for (const [id, coverage, query, expectedId] of cases) {
  const hits = retrieveKnowledge({ query, coverage, limit: 6 });
  assert.ok(hits.some(card => card.id === expectedId), `${id}: ${expectedId} not recalled`);
  for (const card of hits) {
    assert.ok(card.evidenceId && card.source?.id && card.source?.title);
    if (coverage !== 'unknown' && card.coverages.length) {
      assert.ok(card.coverages.includes(coverage), `${id}: incompatible coverage`);
    }
    if (coverage === 'unknown' && card.coverages.length) {
      assert.equal(card.applicability, 'conditional');
    }
    assert.equal(Object.hasOwn(card, 'confidence'), false);
    assert.equal(Object.hasOwn(card, 'probability'), false);
  }
  console.log(`${id}: retrieval contract passed`);
}

const plays = starterWorkspace().plays;
const offense = plays.find(play => play.book === 'offense');
const defense = plays.find(play => play.book === 'defense');
for (const coverage of ['unknown', 'cover2', 'cover2_read']) {
  const facts = diagramFacts(offense, defense, { coverage });
  assert.equal(facts.kind, 'static_diagram');
  assert.equal(facts.coverage, coverage);
  assert.ok(facts.assumptions.length > 0 && facts.unknowns.length > 0);
  assert.equal(Object.hasOwn(facts.counts, 'protectors'), false);
}
console.log('Static facts preserve coverage assumptions and execution unknowns');
NODE
```

补充执行现有协议与 UI 回归：

```bash
node --test tests/matchup-agent.test.mjs tests/matchup-api.test.mjs tests/matchup-ui.test.mjs
```

这些测试中的模拟请求用于检查强制读取上下文、工具限额、响应格式与来源白名单。它们不能代替 F01–F12 的真实模型复核。完整分支还应运行本次新增的知识/存储回归及仓库要求的 `npm test`、`npm run check`、`npm run typecheck`、`npm run build`；最终记录说明实际运行范围和任何环境限制。

## 资料与引用的配套验收

| 场景 | 可复现操作 | 通过标准 |
| --- | --- | --- |
| 同页图文 | 导入含明确 `sourceId`、`page`、`regionId`、`figures` 的知识包；另加同页无关图 | 保留显式关联；不自动带回同页所有图；界面不会因 imageRef 存在就声称模型看过图片 |
| 文本资料范围 | 导入一条无关球队笔记后执行 F04；再删除或替换 | 命中情况真实；没有为了展示知识库而强塞无关条目；删除/替换后旧报告失效 |
| 重复与冲突 | 用同一 source/card ID 导入不同内容；另用新 ID 导入相反教练意见 | 身份冲突被识别；内容相反但身份不同的资料可保留为待复核信息，不能凭数量自动裁定正确 |
| 跨战术本 | 在 A 战术本导入专用术语，切换 B；A 的导入或分析请求尚未结束时再切换 | B 不显示 A 的本地资料；迟到结果不能写入当前 B 的状态 |
| 不存在的引用 | 模拟模型返回虚构 player、route 或 knowledge evidence ID | 报错或进入受限修复路径；不能生成看似有效的来源按钮 |
| 合法但不支持结论 | 模型用真实 Mesh 来源支持“Cover 2 Read 必定跑空” | 引用 ID 校验可以通过，但人工评审必须判失败；最终元信息不能宣称语义支持已被验证 |

## 真实 LLM 质量的记录方法与边界

在没有真实 API 凭证、实际请求与人工复核记录时，F01–F12 的**生成回答质量均为未验证**。本轮自动测试即使全部通过，也不能改写这一状态。读取到了上下文、格式正确、引用 ID 合法，分别只说明对应程序契约通过。

真实验证时记录 provider、协议、精确 model ID、日期、输入快照、coverage、情境、召回知识 ID、原始输出和失败原因。不同 provider 分别记录，不能以其中一个通过替代其他服务。密钥不得进入记录。首次评估至少让每个场景运行三次，保留失败答案；若样本很小，不用通过比例宣传产品准确率。

教练复核采用以下判据：

1. **事实**：有没有编造不存在的球员、路线、区域、保护或真实责任？
2. **条件**：有没有正确区分未知、用户假设、spot/Read/Match 和具体球队检查？
3. **证据**：引用段落是否实际支持结论，且没有忽略其关键前提或反例？
4. **行动**：是否给出了与当前战术相关的观察对象、条件变化和可练习的提示？
5. **表达**：中英两版是否保留相同限制，是否出现没有校准依据的胜率、推进码数或必然结果？

任一案例出现虚构责任、遗漏关键反例或把静态几何写成确定结果，应判该案例失败。对于含糊但不错误的泛化回答，记录为“缺乏当前图的具体依据”，不要为了提高通过率直接计为成功。软件校验与教练评估解决不同问题，两类结果应同时展示。
