# Madden 第二批：80 张原图的可编辑重建

日期：2026-10-27。基于仓库已打包的 Madden 27 图像，逐张对照球员标记和彩色路径重建像素坐标，并将路线叠回原图复核。

## 本批结果

- 新增 **80 张不同原图**的可编辑几何，对应 **90 个球队目录条目**：Eagles 新增 60 条、Ravens 新增 30 条。10 张原图由两队共用，因此同一份已核对几何分别绑定各自球队的目录 ID、来源页面和导入记录。
- 原有 30 条保留不变；当前共 **120 条可编辑**（Eagles 78 / Ravens 42），另有 **1,088 条**仍保留原图。剩余条目没有全部逐张复核，不应把它们统称为模糊或无法识别。
- 每张图保留 11 个可移动的起点、可辨认路线和必要的选项分支；白色和蓝色保护线仅作为图示。图上看不清的路线归属、时序、图外延伸、真实人员身份、传球目标及防守对抗不会靠名称猜测。选项分支以可选路线呈现；初始球在 QB 手中，演练时长为可调整的示意值。
- 已保存的原图战术不会自动替换。可在战术库加入可编辑版；已有原图可通过「创建可编辑副本」生成新副本，保留原图和笔记。
- 本批优先选择可区分起点和路线的图；未确认的其他条目继续使用原图。图片校核并不代表对 Madden 比赛逻辑或所有战术语义的复原。

## 数据与验证

- `web/data/madden-editable-80.js`：按球队目录 ID 存储可编辑几何。原图坐标系为 554 × 256。
- `scripts/madden-trace-review-80.json`：每条数据及对应原始 JPEG 的 SHA-256，允许与目录及素材清单对照；同图复用仅在图像字节和目录战术名称、阵型、游戏版本一致时采用。
- `docs/madden-conversion-audit.json` 与 `web/data/madden-trace-status.js`：记录全部 1,208 条的当前状态；历史批次见 [MADDEN_BATCH.md](MADDEN_BATCH.md) 和 [MADDEN_EDITABLE.md](MADDEN_EDITABLE.md)。
- 相同源图的两个球队条目使用相同几何但保留各自来源；已有 20 条首批数据和 10 条上一批数据未更改。
- 路线的像素折线是可编辑近似值，不宣称完整还原比赛时序。阵型覆盖、归属和路线以原图可见信息为准。

## 本批目录

每行对应一张不同原图；两队共享原图的行分别链接两队目录页面。

| 阵型 | 战术 | 球队来源 |
|---|---|---|
| Gun Bunch Quads | BUNCH TRAIL | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-bunch-quads/bunch-trail/) |
| Gun Bunch Quads | DRAG UNDER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-bunch-quads/drag-under/) |
| Gun Bunch TE | CURL FLAT CORNER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-bunch-te/curl-flat-corner/) |
| Gun Bunch TE | PA BOOT OVER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-bunch-te/pa-boot-over/) |
| Gun Bunch TE | SPACING | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-bunch-te/spacing/) |
| Gun Bunch TE | TRIPLE OUT | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-bunch-te/triple-out/) |
| Gun Bunch TE | X SPOT | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-bunch-te/x-spot/) |
| Gun Doubles Clamp Stack | CURL OHIO | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-doubles-clamp-stack/curl-ohio/) |
| Gun Doubles Clamp Stack | HITCH HB RAIL | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-doubles-clamp-stack/hitch-hb-rail/) |
| Gun Doubles Clamp Stack | SPOT CHOICE | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-doubles-clamp-stack/spot-choice/) |
| Gun Doubles Clamp Stack | Y OHIO RETURN | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-doubles-clamp-stack/y-ohio-return/) |
| Gun Doubles Off Close | DOUBLE POST | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-doubles-off-close/double-post/) |
| Gun Doubles Off Close | PA Y CROSS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-doubles-off-close/pa-y-cross/) |
| Gun Doubles Off Close | X DAGGER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-doubles-off-close/x-dagger/) |
| Gun Empty Base Flex | LEVELS SWITCH | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-base-flex/levels-switch/) |
| Gun Empty Base Flex | MIDDLE HI LO | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-base-flex/middle-hi-lo/) |
| Gun Empty Base Flex | REDZONE UP | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-base-flex/redzone-up/) |
| Gun Empty Base Flex | STICK | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-base-flex/stick/) |
| Gun Empty Base Flex | STICK N NOD | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-base-flex/stick-n-nod/) |
| Gun Empty Base Flex | TRAIL SHAKE | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-base-flex/trail-shake/) |
| Gun Empty Base Flex | Y CORNER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-base-flex/y-corner/) |
| Gun Empty Quads | CURL PIVOT DIG | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-empty-quads/curl-pivot-dig/) |
| Gun Empty Quads | FOUR VERTICALS | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-empty-quads/four-verticals/) |
| Gun Empty Quads | OUT DOUBLE UNDER | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-empty-quads/out-double-under/) |
| Gun Empty Quads | VERT DOUBLE UNDER | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-empty-quads/vert-double-under/) |
| Gun Empty Trey Stack | BENCH CORNER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/bench-corner/) |
| Gun Empty Trey Stack | CURL FLAT SALEM | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/curl-flat-salem/) |
| Gun Empty Trey Stack | CURL SWITCH | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/curl-switch/) |
| Gun Empty Trey Stack | FADE OUT | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/fade-out/) |
| Gun Empty Trey Stack | LEVELS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/levels/) |
| Gun Empty Trey Stack | SMASH SEAM | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/smash-seam/) |
| Gun Empty Trey Stack | STICK N NOD | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/stick-n-nod/) |
| Gun Empty Trey Stack | Y STICK | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/y-stick/) |
| Gun Empty Trey Stack | ZL UNDER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-empty-trey-stack/zl-under/) |
| Gun Normal Y Off | CORNER STRIKE | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-normal-y-off/corner-strike/) |
| Gun Normal Y Off | CURL COMBO | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-normal-y-off/curl-combo/) |
| Gun Normal Y Off | DOUBLE DIG | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-normal-y-off/double-dig/) |
| Gun Normal Y Off | FOUR VERTICALS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-normal-y-off/four-verticals/) |
| Gun Normal Y Off | SLANT FLAT | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-normal-y-off/slant-flat/) |
| Gun Normal Y Off | STICK SLOT OPTION | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-normal-y-off/stick-slot-option/) |
| Gun Tight Y Off Wk | DAGGER H-SWING | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/dagger-h--swing/) |
| Gun Tight Y Off Wk | HAMMER DAGGER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-tight-y-off-wk/hammer-dagger/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/hammer-dagger/) |
| Gun Tight Y Off Wk | LEVELS | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/levels/) |
| Gun Tight Y Off Wk | MESH WHIPS | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/mesh-whips/) |
| Gun Tight Y Off Wk | PA CORNER | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/pa-corner/) |
| Gun Tight Y Off Wk | PIVOT RETURN | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/pivot-return/) |
| Gun Tight Y Off Wk | SMASH HAMMER | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/smash-hammer/) |
| Gun Tight Y Off Wk | SMASH Y DOUBLE | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/smash-y-double/) |
| Gun Tight Y Off Wk | SPOT Y MIDDLE | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-tight-y-off-wk/spot-y-middle/) |
| Gun Trey Open | CORNER STRIKE | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/corner-strike/) |
| Gun Trey Open | CURLSX GO | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/curlsx-go/) |
| Gun Trey Open | DAGGER DEEP CURL | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/dagger-deep-curl/) |
| Gun Trey Open | DOUBLE INS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/double-ins/) |
| Gun Trey Open | DRAG VERTICALS | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/drag-verticals/) |
| Gun Trey Open | FOUR VERTICALS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/four-verticals/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/four-verticals/) |
| Gun Trey Open | JET NEW ORLEANS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/jet-new-orleans/) |
| Gun Trey Open | LEVELS SWITCH | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/levels-switch/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/levels-switch/) |
| Gun Trey Open | MESH | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/mesh/) |
| Gun Trey Open | MESH REWIND | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/mesh-rewind/) |
| Gun Trey Open | PA READ | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/pa-read/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/pa-read/) |
| Gun Trey Open | SALEM | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/salem/) |
| Gun Trey Open | SHOCKH OPTION | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/shockh-option/) |
| Gun Trey Open | SLANTS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/slants/) |
| Gun Trey Open | SLOT DRIVE | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/slot-drive/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/slot-drive/) |
| Gun Trey Open | STICK | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/stick/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/stick/) |
| Gun Trey Open | STRONG FLOOD | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/strong-flood/) |
| Gun Trey Open | Y CORNER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/y-corner/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/y-corner/) |
| Gun Trey Open | Y-DRAG | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trey-open/y--drag/) |
| Gun Trey Open | YSAIL | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/ysail/) |
| Gun Trey Open | Z UNDER | [Ravens](https://huddle.gg/27/playbooks/ravens-off/gun-trey-open/z-under/) |
| Gun Trips TE Flex | DAGGER | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trips-te-flex/dagger/) |
| Gun Trips TE Flex | LEVELS SAIL | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trips-te-flex/levels-sail/) |
| Gun Trips TE Flex | PA FORK | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trips-te-flex/pa-fork/) |
| Gun Trips TE Flex | PA SHOT CROSSERS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trips-te-flex/pa-shot-crossers/) |
| Gun Trips TE Flex | POST RAIL | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trips-te-flex/post-rail/) |
| Gun Trips TE Flex | TE IN | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trips-te-flex/te-in/) |
| Gun Trips TE Flex | VERTICALS | [Eagles](https://huddle.gg/27/playbooks/eagles-off/gun-trips-te-flex/verticals/) |
| Hail Mary Hail Mary | GOAL POST | [Eagles](https://huddle.gg/27/playbooks/eagles-off/hail-mary-hail-mary/goal-post/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/hail-mary-hail-mary/goal-post/) |
| Hail Mary Hail Mary | HAIL MARY | [Eagles](https://huddle.gg/27/playbooks/eagles-off/hail-mary-hail-mary/hail-mary/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/hail-mary-hail-mary/hail-mary/) |
| Hail Mary Hail Mary | SHOT SAVE CLOCK | [Eagles](https://huddle.gg/27/playbooks/eagles-off/hail-mary-hail-mary/shot-save-clock/) / [Ravens](https://huddle.gg/27/playbooks/ravens-off/hail-mary-hail-mary/shot-save-clock/) |
