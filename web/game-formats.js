// League size is a play-level choice. Workspace settings only supply defaults
// for new plays, so a five-player book can still contain an eleven-player play.
export const LEAGUE_SIZES = Object.freeze([5, 6, 7, 8, 9, 11, 12]);

export const TACKLE_UNIT_FORMATIONS = Object.freeze({
  offense: Object.freeze(['Gun Trips', 'Gun Doubles', 'Gun Empty', 'Singleback', 'Pistol', 'I Formation']),
  defense: Object.freeze(['4–3', '3–4', 'Nickel', 'Dime']),
  special: Object.freeze(['Field Goal', 'Punt', 'Kickoff', 'Kick Return']),
});

export const TACKLE_FORMATIONS = Object.freeze([
  ...TACKLE_UNIT_FORMATIONS.offense,
  ...TACKLE_UNIT_FORMATIONS.defense,
  ...TACKLE_UNIT_FORMATIONS.special,
]);

export const FLAG5_FORMATIONS = Object.freeze({
  offense: Object.freeze(['Flag 5 Spread', 'Flag 5 Trips', 'Flag 5 Bunch']),
  defense: Object.freeze(['Flag 5 Zone', 'Flag 5 Man']),
});

const flagNames = [...FLAG5_FORMATIONS.offense, ...FLAG5_FORMATIONS.defense];
export const BUILT_IN_FORMATIONS = Object.freeze([...TACKLE_FORMATIONS, ...flagNames]);
export const DEFENSE_FORMATIONS = Object.freeze([
  ...TACKLE_UNIT_FORMATIONS.defense,
  '4-3',
  '3-4',
  ...FLAG5_FORMATIONS.defense,
]);

export const CATEGORY_PRESETS = Object.freeze({
  'zh-CN': Object.freeze({
    offense: Object.freeze(['传球', '跑球', 'RPO', '假跑真传']),
    defense: Object.freeze(['区域防守', '盯人防守', '冲传']),
    special: Object.freeze(['射门', '弃踢', '开球', '回攻']),
  }),
  en: Object.freeze({
    offense: Object.freeze(['Pass', 'Run', 'RPO', 'Play action']),
    defense: Object.freeze(['Zone coverage', 'Man coverage', 'Blitz']),
    special: Object.freeze(['Field goal', 'Punt', 'Kickoff', 'Kick return']),
  }),
});

const normalizeLocale = locale => (locale === 'en' ? 'en' : 'zh-CN');

export function categoryOptions(book = 'offense', locale = 'zh-CN') {
  const dict = CATEGORY_PRESETS[normalizeLocale(locale)];
  return [...(dict[book] || dict.offense)];
}

export function formationOptions(book = 'offense', count = 11) {
  if (count === 5) return [...FLAG5_FORMATIONS[book === 'defense' ? 'defense' : 'offense']];
  return [...(TACKLE_UNIT_FORMATIONS[book] || TACKLE_UNIT_FORMATIONS.offense)];
}

export function formationGroups(book = 'offense', count = 11) {
  if (count === 5) {
    return [{ key: 'flag5', items: formationOptions(book, 5) }];
  }
  if (book === 'defense') {
    return [
      { key: 'defense_base', items: ['4–3', '3–4'] },
      { key: 'defense_sub', items: ['Nickel', 'Dime'] },
    ];
  }
  if (book === 'special') {
    return [{ key: 'special_units', items: [...TACKLE_UNIT_FORMATIONS.special] }];
  }
  return [
    { key: 'offense_pass', items: ['Gun Trips', 'Gun Doubles', 'Gun Empty'] },
    { key: 'offense_run', items: ['Singleback', 'Pistol', 'I Formation'] },
  ];
}

export function defaultFormation(book = 'offense', count = 11) {
  if (count === 5) return FLAG5_FORMATIONS[book === 'defense' ? 'defense' : 'offense'][0];
  return book === 'defense' ? '4–3' : book === 'special' ? 'Field Goal' : 'Gun Trips';
}

export function defaultCategoryFor(book = 'offense', formation = '', locale = 'zh-CN') {
  const en = normalizeLocale(locale) === 'en';
  const normalized = { '4-3': '4–3', '3-4': '3–4' }[formation] || formation;
  if (book === 'defense') {
    if (normalized === 'Flag 5 Man') return en ? 'Man coverage' : '盯人防守';
    return en ? 'Zone coverage' : '区域防守';
  }
  if (book === 'special') {
    if (normalized === 'Punt') return en ? 'Punt' : '弃踢';
    if (normalized === 'Kickoff') return en ? 'Kickoff' : '开球';
    if (normalized === 'Kick Return') return en ? 'Kick return' : '回攻';
    return en ? 'Field goal' : '射门';
  }
  if (['Singleback', 'I Formation', 'Pistol'].includes(normalized)) {
    return en ? 'Run' : '跑球';
  }
  return en ? 'Pass' : '传球';
}

export function recommendedFormationForCategory(book = 'offense', count = 11, category = '') {
  const token = String(category || '').trim().toLowerCase();
  if (count === 5) {
    if (book === 'defense') {
      if (token === '盯人防守' || token === 'man coverage' || token === '冲传' || token === 'blitz') return 'Flag 5 Man';
      return 'Flag 5 Zone';
    }
    if (token === '跑球' || token === 'run') return 'Flag 5 Bunch';
    if (token === 'rpo') return 'Flag 5 Trips';
    return 'Flag 5 Spread';
  }
  if (book === 'defense') {
    if (token === '盯人防守' || token === 'man coverage' || token === '冲传' || token === 'blitz') return 'Nickel';
    return '4–3';
  }
  if (book === 'special') {
    if (token === '弃踢' || token === 'punt') return 'Punt';
    if (token === '开球' || token === 'kickoff') return 'Kickoff';
    if (token === '回攻' || token === 'kick return') return 'Kick Return';
    return 'Field Goal';
  }
  if (token === '跑球' || token === 'run' || token === '假跑真传' || token === 'play action') return 'Singleback';
  if (token === 'rpo') return 'Pistol';
  return 'Gun Trips';
}

const ELEVEN_PERSONNEL_BY_FORMATION = Object.freeze({
  'Gun Trips': '11 personnel',
  'Gun Doubles': '11 personnel',
  'Gun Empty': '10 personnel',
  Singleback: '11 personnel',
  Pistol: '11 personnel',
  'I Formation': '21 personnel',
  '4–3': '4–3 Base',
  '3–4': '3–4 Base',
  Nickel: '4–2–5 Nickel',
  Dime: '4–1–6 Dime',
  'Field Goal': 'Field Goal Unit',
  Punt: 'Punt Unit',
  Kickoff: 'Kickoff Unit',
  'Kick Return': 'Kick Return Unit',
});

export function defaultPersonnelFor(book = 'offense', formation = '', count = 11, locale = 'zh-CN') {
  const en = normalizeLocale(locale) === 'en';
  if (count === 5) return en ? '5v5 Flag' : '5 人腰旗';
  if (count !== 11) return en ? `${count} players` : `${count} 人制`;
  const normalized = { '4-3': '4–3', '3-4': '3–4' }[formation] || formation;
  if (ELEVEN_PERSONNEL_BY_FORMATION[normalized]) return ELEVEN_PERSONNEL_BY_FORMATION[normalized];
  if (book === 'defense') return '4–3 Base';
  if (book === 'special') return 'Field Goal Unit';
  return '11 personnel';
}

export function isAutoPersonnel(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (Object.values(ELEVEN_PERSONNEL_BY_FORMATION).includes(text)) return true;
  if (text === '5 人腰旗' || text === '5v5 Flag') return true;
  return /^\d+\s*(?:人制|players)$/.test(text);
}

export function resolveFormation(formation, book = 'offense', count = 11) {
  const name = { '4-3': '4–3', '3-4': '3–4' }[formation] || formation;
  const options = formationOptions(book, count);
  if (!name) return defaultFormation(book, count);
  if (options.includes(name)) return name;
  if (count === 5 && TACKLE_FORMATIONS.includes(name)) {
    if (book !== 'defense' && name === 'Gun Trips') return 'Flag 5 Trips';
    return defaultFormation(book, count);
  }
  if (flagNames.includes(name)) return defaultFormation(book, count);
  return name; // Saved custom formations retain their coach-provided name.
}

export function getPlayLeague(play, fallback = 11) {
  if (LEAGUE_SIZES.includes(play?.league)) return play.league;
  // An imported Madden image has no editable markers and remains eleven-player.
  if (play?.reference || play?.diagramSource) return 11;
  if (flagNames.includes(play?.formation)) return 5;
  const players = play?.players || [];
  const side = play?.book === 'defense' ? 'defense' : 'offense';
  let count = players.filter(player => player.side === side).length;
  if (!count && play?.book === 'special') count = players.filter(player => player.side === side || player.side === 'defense').length;
  return LEAGUE_SIZES.includes(count) ? count : LEAGUE_SIZES.includes(fallback) ? fallback : 11;
}

export function isFlag5Play(play) {
  // Five remaining markers alone may be an unfinished eleven-player diagram.
  // A flag rules context requires an explicit league or built-in flag formation.
  return play?.league == null ? flagNames.includes(play?.formation) : play.league === 5;
}
