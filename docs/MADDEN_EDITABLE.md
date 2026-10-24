# 首批 20 个 Madden 图片识别可编辑战术

2026-10-24。以下记录首批 Eagles / Ravens 各 10 个的基线；后续全目录处理与当前数量见 [批次记录](MADDEN_BATCH.md)。来源均为已打包的 Huddle.gg Madden 27 原图。

## 使用

打开 Madden 战术库，默认勾选“仅看可编辑”，切换球队后点“加入可编辑版”或拖入战术本。已有这批战术的原图项可在右侧点“创建可编辑副本”，保留原图和教练笔记；新副本支持移动球员、调整路线节点、镜像、撤销、演练、保存及导出。编辑器上方“原图对照”显示来源图。

## 识别依据与边界

使用视觉识别逐图读取白色球员标记、彩色路径、拐点和箭头，再以原图并排核对，修正球员归属和路线交叉处。不是按战术名称套用通用模板，也未宣称全自动识别整个目录。`web/data/madden-editable.js` 保留每个战术的原图像素坐标（554×256）、来源及识别备注；运行时转换为编辑器坐标。

- 11 个球员起点来自各图可见标记。X/H/Y/Z 等标签按站位指定，不是原图提供的真实人员身份。
- 可见路径以折线节点近似描绘；曲线按采样点近似。图像边缘外的部分不延伸猜测。
- Four Verticals 的可见斜向分支作为选项；蓝色保护示意、白色阻挡线按阻挡图示保留，不参与主线跑动。白色锋线短保护标记未逐一扩展成模拟行为。
- 阻挡、掩护、阅读顺序、防守反应和选项决策没有从静态图还原。
- 所有路线使用可修改的 3 秒演示时长；默认球在 QB 手中，未猜测接球目标或传球时机。
- 用户编辑后仍保留来源信息，但“原图对照”始终展示原始图片，不表示当前改动与原图相同。
- 其他目录项仍为原图；取消“仅看可编辑”可查看。原图版与可编辑副本分别去重，转换不覆盖既有内容。

## 目录

| 球队 | 阵型 | 战术 | 来源 |
|---|---|---|---|
| Eagles | Gun Spread Flex Wk | CORNER STRIKE | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/corner-strike/) |
| Eagles | Gun Spread Flex Wk | DOUBLE CROSS | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/double-cross/) |
| Eagles | Gun Spread Flex Wk | DOUBLE SLANTS | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/double-slants/) |
| Eagles | Gun Spread Flex Wk | FOUR VERTICALS | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/four-verticals/) |
| Eagles | Gun Spread Flex Wk | HB SCISSORS | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/hb-scissors/) |
| Eagles | Gun Spread Flex Wk | HB SLIP SCREEN | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/hb-slip-screen/) |
| Eagles | Gun Spread Flex Wk | HITCH SEAM | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/hitch-seam/) |
| Eagles | Gun Spread Flex Wk | SLOT OUTS | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/slot-outs/) |
| Eagles | Gun Spread Flex Wk | SPOT Y CROSS | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/spot-y-cross/) |
| Eagles | Gun Spread Flex Wk | UNDER | [原图页面](https://huddle.gg/27/playbooks/eagles-off/gun-spread-flex-wk/under/) |
| Ravens | Gun Spread Dbl Flex | DEEP CURL | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-spread-dbl-flex/deep-curl/) |
| Ravens | Gun Spread Dbl Flex | FL CROSS | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-spread-dbl-flex/fl-cross/) |
| Ravens | Gun Spread Dbl Flex | FOUR VERTICALS | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-spread-dbl-flex/four-verticals/) |
| Ravens | Gun Spread Dbl Flex | HB SLIP SCREEN | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-spread-dbl-flex/hb-slip-screen/) |
| Ravens | Gun Spread Dbl Flex | HITCH CORNERS | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-spread-dbl-flex/hitch-corners/) |
| Ravens | Gun Spread Dbl Flex | SLANTS MIDDLE | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-spread-dbl-flex/slants-middle/) |
| Ravens | Gun Spread Dbl Flex | SLOT OUT | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-spread-dbl-flex/slot-out/) |
| Ravens | Gun Doubles HB Wk | CURL COMBO | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-doubles-hb-wk/curl-combo/) |
| Ravens | Gun Doubles HB Wk | DOUBLE POST | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-doubles-hb-wk/double-post/) |
| Ravens | Gun Doubles HB Wk | SAIL DIG | [原图页面](https://huddle.gg/27/playbooks/ravens-off/gun-doubles-hb-wk/sail-dig/) |
