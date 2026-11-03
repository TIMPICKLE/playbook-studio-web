export const editMessages = {
  'zh-CN': {
    reference: '这套战术是原图。请先选择可编辑战术。',
    missing: '本图没有匹配的场上球员「{ref}」。请核对位置、姓名或号码。',
    operation: '当前支持修改一名球员的跑动路线或有序阻挡目标。',
    targets: '请选择 1 至 6 名不同的对方场上球员，按接触顺序排列。',
    points: '跑动路线需要 1 至 32 个有效落点，每个落点必须在场内。',
    motion: '这名球员已有开球前移动。请先在路线设置中确认或调整该动作。',
    limit: '战术已达 100 条路线，请先移除一条路线。',
    block: '{actor} 依次阻挡 {targets}',
    route: '{actor} 的跑动路线 · {count} 个落点'
  },
  en: {
    reference: 'This is a reference image. Select an editable play.',
    missing: 'No on-field player matches “{ref}”. Check the position, name or number.',
    operation: 'Choose one player and request a running route or an ordered set of block targets.',
    targets: 'Choose 1–6 distinct opponents on this play, in contact order.',
    points: 'Provide 1–32 valid waypoints inside the field.',
    motion: 'This player has pre-snap motion. Review or adjust that action in route settings first.',
    limit: 'This play has 100 routes. Remove a route first.',
    block: '{actor} blocks {targets} in order',
    route: '{actor} running route · {count} waypoints'
  }
};
