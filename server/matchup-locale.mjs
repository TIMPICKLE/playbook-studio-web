// Localize presentation-only, server-generated annotations without touching
// user-authored names, notes, tactical content, evidence IDs, or model output.
const warningsEn = {
  '原图战术没有可用坐标，本次只使用名称和阵型等文字；未发送原始图片。': 'Image-only plays have no coordinates. Only text such as names and formations was used; original images were not sent.',
  '战术笔记每套最多发送前 3000 字，可能有内容未包含。': 'Only the first 3,000 characters of each coaching note are sent.',
  '进攻路线信息不足，无法比较具体路线。': 'There is not enough offensive route information to compare routes.',
  '防守战术没有标注覆盖区域，不能判断路线与区域的关系。': 'The defensive play has no coverage zones; route-to-zone relationships cannot be determined.',
  '防守覆盖类型未确认；不要从前线阵型推断覆盖。': 'Defensive coverage is unconfirmed. Do not infer it from the front.',
  '防守图已左右镜像；文字笔记不会自动镜像，请确认方位。': 'The defensive diagram is mirrored; text notes are not. Check the orientation.',
  '图上重叠不代表同一时刻到达；演示时长不是实战时序。': 'Diagram overlap does not mean simultaneous arrival; demo timing is not game timing.',
};
const suffixEn = { '站位': 'position', '选项阻挡': 'option block', '选项移动': 'option motion', '选项传球': 'option pass', '选项路线': 'option route', '阻挡': 'block', '移动': 'motion', '传球': 'pass', '路线': 'route', '防守区域': 'defensive zone' };
export function localizeMatchupAnnotations(evidence, warnings, locale) {
  if (locale !== 'en') return { evidence, warnings };
  return {
    evidence: evidence.map(item => {
      if (item.type === 'knowledge' && item.label.startsWith('覆盖规则 · ')) return { ...item, label: 'Coverage rule · ' + item.label.slice('覆盖规则 · '.length) };
      const split = item.label.lastIndexOf(' · ');
      if (split === -1 || !suffixEn[item.label.slice(split + 3)]) return item;
      let label = item.label.slice(0, split);
      if (item.type === 'route' && label === '球员') label = 'Player';
      if (item.type === 'zone' && label === '未命名区域') label = 'Unnamed zone';
      return { ...item, label: label + ' · ' + suffixEn[item.label.slice(split + 3)] };
    }),
    warnings: warnings.map(warning => warningsEn[warning] || warning),
  };
}
