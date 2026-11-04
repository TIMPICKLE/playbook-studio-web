# Board Assistant 真实模型评测

这组评测包含 50 条中英文教练指令，覆盖 9 类改图操作、歧义澄清、连续跟进、Madden 检索、战术问答和分析移交。每条指令在 `cases.json` 中写明期望结果类型和关键断言。脚本会经过产品使用的模型适配器、工具循环与领域校验，随后检查实际生成的战术数据。

`--list` 只列出用例，`--run` 才会调用模型。没有 `BOARD_ASSISTANT_API_KEY` 或 `OPENAI_API_KEY` 时脚本会退出并保证不发送请求。评测使用合成名单和固定球员 ID，输出不保存 API Key、模型内部推理或 HTTP 请求头。

```sh
node scripts/eval-board-assistant.mjs --list

# 在当前 shell 中设置密钥，避免将实际密钥写入文件或命令历史。
read -r -s BOARD_ASSISTANT_API_KEY
export BOARD_ASSISTANT_API_KEY
node scripts/eval-board-assistant.mjs --run --provider openai --model gpt-6.1-terra \
  --concurrency 3 --out /tmp/board-assistant-baseline.json
unset BOARD_ASSISTANT_API_KEY
```

并发默认为 1，允许 1–4。可以通过 `--case followup`、`--limit 5` 选择小范围用例。更换模型或修改提示词、工具描述、结果 schema 后，先运行小范围，再执行全量用例。

JSON 报告记录整体通过率、分类通过数、每轮结果、关键断言失败原因、模型调用数、工具调用数、修正次数与耗时。`outcomes` 按用例文件顺序排列。对话用例会把第一轮实际生成的操作、摘要和完整路线 ID 传入第二次独立调用，再检查是否修改了同一条路线。

报告中的通过率衡量这 50 条指令在指定模型和代码版本下是否满足固定行为断言。它无法证明所有教练表达都能被正确理解，也无法认证战术建议的足球有效性。搜索用例会检查目录来源与可编辑状态，战术理由仍需要人工审查。名称类统计与几何标签质量由独立检索测试核验。

建议在基线记录中一起注明 Git commit、服务商、模型 ID、运行日期以及失败原因。只有真实运行产生的 JSON 才能作为基线，离线脚本测试用于检查评测器本身是否会识别错误。

## 首次基线

2026-11-04 使用 OpenAI `gpt-6.1-terra` 实际运行了三轮，每轮 50 个用例。

| 报告 | 通过 | 说明 |
|---|---|---|
| [第一轮原始记录](baselines/initial.json) | 48/50 | 发现 dyYards 正方向说明缺失；中文深度跟进首轮目标与初始路线相同，模型合理回答无需修改，未满足原用例的 edit 断言。 |
| [协议基线](baselines/protocol-baseline.json) | 50/50 | schema 补充方向说明，中文跟进用例仅该场景改用 8 码初始路线。156 次模型及 HTTP 请求、200 次工具调用、0 次工具错误、0 次校验修正。 |
| [最终源码记录](baselines/gpt-6.1-terra-2026-11-04.json) | 50/50 | 统一剩余结构限制后重跑。159 次模型及 HTTP 请求、207 次工具调用、0 次工具错误、2 次校验修正。 |

后两轮报告包含执行时的代码和用例指纹，明确标记代码来自工作区。首次报告保留原始字节，没有补写后来才增加的指纹。第一轮与后两轮用例的初始状态有所不同，因此只能用来说明修复和测试更正，不能作为同一数据集上的严格前后提升实验。
