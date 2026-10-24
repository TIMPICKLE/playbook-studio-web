# Madden 全目录识别批次记录

日期：2026-10-24。对现有目录的全部 1,208 个队伍战术条目核对来源，其中此前 20 个可编辑项保持原有几何不变，本轮尝试其余 1,188 个。

## 结果

- 本轮新增 10 个；当前可编辑合计 30 个（Eagles 18 / Ravens 12）。
- 1,178 个保留原图，没有生成未确认的球员或路线。保留项并不意味着原图客观上无法辨认；它表示当前流程没有达到可靠恢复的标准，没有逐张手工重建所有未通过项。
- 自动流程产出 5 个候选；视觉对照发现其中 2 个有路线连接或阻挡信息未恢复，放弃转换；3 个候选经端点校核修正后收录。另外从接近通过的图中视觉复核、重建 7 个。
- 所有新增项均经过原图/路径并排对照。没有直接将自动候选当作已确认战术。

## 当前未通过原因

以下为自动筛查未通过的技术原因，不等同于经过逐图人工鉴定的图像质量结论。

| 原因 | 保留原图数量 |
|---|---:|
| 球员标记未全部确认 | 513 |
| 交叉或分支归属未确认 | 157 |
| 持球人起点未可靠确认 | 135 |
| 可见路线缺少明确起点 | 127 |
| 锋线标记未可靠确认 | 107 |
| 存在未确认的分支或线段 | 90 |
| 路线归属未完整恢复 | 31 |
| 路线与多个球员标记粘连 | 10 |
| 路线片段不完整 | 6 |
| 复核后仍有路线或阻挡归属不确定 | 2 |

## 本轮新增

| 球队 | 阵型 | 战术 |
|---|---|---|
| Eagles | Gun Bunch Quads | SPACING |
| Eagles | Gun Bunch Quads | SPOT |
| Eagles | Gun Bunch TE | MESH |
| Eagles | Gun Bunch X Nasty | Y FLAT GOALLINE |
| Eagles | Gun Bunch X Nasty | Z SPOT GOALLINE |
| Eagles | Gun Doubles Clamp Stack | FLOOD SEAM |
| Eagles | Gun Doubles Off Close | PIVOT IN SEAMS |
| Eagles | Gun Empty Base Flex | ALL HITCH |
| Ravens | Gun Deuce Close | STICK SWITCH |
| Ravens | Gun Trips TE Offset Wk | PA VERTS SHOT |

## 实现与重跑

- `scripts/trace-madden-images.py` 读取实际 JPEG，分离白色标记和有色线条，提取骨架与连通路径；只产生草稿候选和审计文件，不修改运行时战术或工作区。
- 短箭头分支、可明确延续的交叉和锋线标记遮挡仅作为候选提取；含歧义、丢失路径或起点不唯一时保留原图。
- `scripts/madden-trace-review.json` 保存本轮逐项复核的最终像素几何及来源 SHA-256；运行时只收录已复核记录。
- `docs/madden-conversion-audit.json` 覆盖 1,208 项的最终状态、未通过原因及图像校验值，确保无遗漏。
- `web/data/madden-editable-seed.js` 冻结此前 20 项；扩展记录单独保存在 `madden-editable-batch.js`。

离线识别依赖只用于开发，不加入浏览器或服务端依赖：

```bash
python -m pip install -r scripts/trace-madden-requirements.txt
node scripts/materialize-huddle.mjs
python scripts/trace-madden-images.py --output /tmp/madden-drafts
```

输出候选必须再次视觉复核；运行此命令不会自行加入可编辑目录。

## 仍然适用的边界

可编辑数据保留的是可辨认的站位、路径及分支的近似描绘，E1–E5 是站位编号。时序是可调整的演示值，接球目标与真实战术阅读逻辑没有从静态图推断。阻挡仅保留图示，不模拟防守对抗。原图可继续预览、加入、做笔记、导出和打印；已保存工作区不自动替换。
