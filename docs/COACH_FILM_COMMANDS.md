# 教练讲解的 AI 接口

在桌面编辑器打开画布助手，说「停在出手那一帧，比较 H 和 Y 的纵深」。助手读取当前战术的真实事件和球员，定位到出手，选中两人，从返回画面读取结果。在内置的 Mesh 战术中，出手发生在 2.0 秒，H 在开球线前 7.5 码，Y 在开球线前 4.5 码，相差 3.0 码。其他战术的时间和读数由各自的演练决定。

## 工具调用

| 工具 | 参数示例 | 返回内容 |
| --- | --- | --- |
| `list_capabilities` | `{"category":"film"}` | 讲解命令目录，含 `film_event`、`film_focus`、`film_lesson` 等名称 |
| `get_command_schema` | `{"command":"film_lesson"}` | 该命令的 JSON Schema，含课件各动作允许的参数 |
| `read_film` | `{}` | 当前设备、战术、可用事件与球员，以及已打开房间的画面状态 |
| `control_film` | `{"command":{"operation":"event","event":"release"}}` | 操作完成后返回当前状态。能力查询返回目录。执行失败时返回 `error`、`code` 和适用的 `details` |

助手可以对同一帧连续执行两次 `control_film`。下列是两次调用各自的参数。实际运行时优先使用 `read_film` 返回的球员 ID。

```json
[
  {"command":{"operation":"event","event":"release"}},
  {"command":{"operation":"focus","players":["H","Y"]}}
]
```

## 房间操作

| `operation` | 参数 | 行为 |
| --- | --- | --- |
| `open`、`close` | 无 | 打开当前战术的教练讲解或回到编辑器 |
| `state`、`capabilities` | 无 | 读取当前场景，或读取带参数约束的命令目录 |
| `event` | `event` | 接受 `start`、`release`、`arrival`、`end`、`previous`、`next`。按已编排的事件定位，同一秒的两个事件可逐个访问 |
| `seek` | `time` | 按秒精准暂停，范围含 0 和本战术时长 |
| `play`、`pause` | 无 | 播放、暂停。终点播放会从头开始 |
| `speed` | `speed` | 支持 0.5、1、1.5、2 倍速 |
| `theme` | `theme` | 本次讲解使用 `light` 或 `dark` |
| `focus` | `players` | 一次设置完整名单，选 1 或 2 名互异球员。任一人解析失败，保留原选择 |
| `addFocus`、`removeFocus` | `player` | 加入或移出单人。已在名单中的球员再次加入会保留其原位 |
| `replaceFocus` | `replace`、`player` | 用 `player` 替换已选的 `replace`，保持另一个位置 |
| `clearFocus`、`cancelReplacement` | 无 | 分别清空选人，或撤销界面上待确认的第三人、保留已有两人 |
| `pin`、`unpin` | `pin` 可选 `time` | 固定当前或指定时刻的参考帧，或解除固定。换选球员后，参考读数跟随新的选人 |
| `lesson` | `action` 及下表参数 | 编辑、讲授或保存本机课件 |

球员参数支持精确 ID、位置标签或界面显示名。出现同名时，`PLAYER_AMBIGUOUS` 的 `details.candidates` 列出候选 ID 和显示名。两个位置已占用时，`FOCUS_FULL` 返回已选 ID，便于明确替换对象。

## 课件操作

每套战术、每个工作区可以在本机保存一份最多三个停点的课件。每次操作使用 `{"operation":"lesson","action":"…"}`。索引从 0 开始，已有两名焦点时顺序会保留。

| `action` | 参数 | 行为 |
| --- | --- | --- |
| `state` | 可选 `includeAnswers` | 查看课件。显式设置 `true` 可供教练核对全部已编写的答案 |
| `open`、`close` | 无 | 展开或收起课件面板 |
| `add` | 必填 `question`，可选 `answer`、`time`、`focusIds` | 收录一个停点。省略时间、焦点时，采集当前画面 |
| `update` | `question`、`answer` 至少一项，可选 `index` | 编辑提示文字。传入空字符串可清空参考答案 |
| `replace` | 可选 `index`、`time`、`focusIds` | 保留问题和答案，重新记录停点的时间与球员 |
| `remove`、`select` | `index`。删除时可省略 | 移除或访问停点 |
| `previous`、`next`、`revisit` | `revisit` 可选 `index` | 回到上一停点、下一停点或指定停点，恢复时间和焦点 |
| `reveal`、`hide` | 可选 `index` | 揭晓答案和路线，或重新提问 |
| `cancel` | 无 | 取消界面上正在编辑的停点表单 |
| `save`、`load` | 无 | 保存到本机或加载该工作区、该战术的课件。布局或时序变更后，加载会报告版本过期 |

省略可选索引时使用选中的停点。问题上限为 160，答案上限为 320。显式的 `focusIds` 只接受当前战术的球员 ID，空数组表示不聚焦球员。例子先记录第一个问题，再向学生揭晓。

```json
[
  {"command":{"operation":"lesson","action":"add","time":2,"question":"出手时谁跑得更深？","answer":"H"}},
  {"command":{"operation":"lesson","action":"reveal","index":0}}
]
```

## 状态与边界

- 房间状态以 `version: 1` 标识。`players[].position`、`ball.position`、`focus[].origin` 与 `focus[].trail` 使用和画面一致的场地图坐标。`ball.phase` 标明控球、出手、飞行、到达或接球。`activeEvent` 能区分同一时刻的多个事件。
- `focusIds` 保留选人顺序。`focus[].depthYards` 与 `comparison.gapYards` 使用开球线作为基准。缺少码数标定的场地返回 `null`，仍可用 `comparison.deeperId`、`shallowerId` 判断前后。深度相同的两人对应两个空 ID。
- `pinnedTime` 是钉住的时刻。`reference` 包含该时刻的选人位置、短尾迹和比较。`questionMasked` 为真时，参考帧在通用读屏中隐藏。题目未揭晓时，常规课件快照省略答案。
- `available` 给出与当前状态相关的操作。无传球的战术没有出手或到达事件，静止阵型可选人，纯参考图只能展示图像。设备与试点分组的可用能力由编辑器宿主返回，事件简版沿用常规演练的时间轴。
- 执行失败时可读取具体原因。常见返回有 `INVALID_COMMAND`、`EVENT_UNAVAILABLE`、`TIME_OUT_OF_RANGE`、`REFERENCE_ONLY`、`NO_MOTION` 与 `LESSON_STALE`。课件在其他标签页更新时会返回 `LESSON_CONFLICT`，可以先加载最新版本再决定如何编辑。

仓内房间对象提供 `room.readState()` 和 `await room.perform(command)`。返回值可直接 JSON 序列化，修改返回对象不影响编辑器。各项参数、错误分支和回归用例随源码维护。[命令定义](../web/coach-film-commands.js) · [接口测试](../tests/coach-film-commands.test.mjs) · [AI 手册](AI_GUIDE.md)
