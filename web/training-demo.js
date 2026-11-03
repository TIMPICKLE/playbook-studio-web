import { COLORS } from './model.js';
import { publishDrill } from './training-model.js';
import en from './locales/training-demo.en.js';
import zh from './locales/training-demo.zh-CN.js';

// Both reps start from the same 11-on-11 look. Labels are position names, never identities.
const offense = [
  ['lt', 'LT', 40, 67], ['lg', 'LG', 45, 67], ['c', 'C', 50, 67], ['rg', 'RG', 55, 67], ['rt', 'RT', 60, 67],
  ['qb', 'QB', 50, 78], ['rb', 'RB', 60, 79], ['x', 'X', 13, 67], ['y', 'Y', 26, 70], ['h', 'H', 73, 70], ['z', 'Z', 87, 67],
];
const defense = [
  ['le', 'DE', 35, 63], ['ltackle', 'DT', 42.5, 63], ['rtackle', 'DT', 57.5, 63], ['re', 'DE', 65, 63],
  ['will', 'W', 47.5, 62], ['mike', 'M', 52.5, 62], ['lcb', 'CB', 13, 59], ['rcb', 'CB', 87, 59],
  ['nickel', 'NB', 71, 56], ['ss', 'SS', 31, 45], ['fs', 'FS', 63, 37],
];
function examplePlay(variant, title) {
  const markers = (rows, side) => rows.map(([id, label, x, y]) => ({
    id, label, x, y, side, name: '', color: COLORS[side], shape: side === 'defense' ? 'square' : 'circle',
  }));
  const players = [...markers(offense, 'offense'), ...markers(defense, 'defense')];
  const routes = [];
  function route(playerId, x, y, kind = 'route') {
    const p = players.find(marker => marker.id === playerId);
    routes.push({ id: 'path-' + playerId, playerId, points: [{ x: p.x, y: p.y }, { x, y }], kind, color: p.color,
      smooth: false, endCap: kind === 'block' ? 'bar' : 'arrow', delay: 0.4, duration: 1.4, optional: false });
  }
  route('will', variant === 'rush' ? 47.5 : 40, variant === 'rush' ? 74 : 49);
  route('mike', 60, 49);
  for (const [id, x, y] of [['le', 38, 73], ['re', 62, 73], ['ltackle', 42.5, 69], ['rtackle', 57.5, 69]]) route(id, x, y);
  for (const [id, , x] of offense.slice(0, 5)) route(id, x, 69, 'block');
  for (const [id, x, y] of [['qb', 50, 82], ['x', 22, 52], ['y', 34, 54], ['h', 66, 54], ['z', 80, 52]]) route(id, x, y);
  return { id: 'training-example-' + variant, title, book: 'offense', formation: 'Gun Doubles', category: 'Pass', personnel: '11 personnel',
    notes: '', favorite: false, createdAt: '', players, routes, zones: [], annotations: [], ball: { holderId: 'qb', receiverId: '', passAt: 2, arriveAt: 3 } };
}

export function trainingDemo(locale = 'zh-CN') {
  const words = locale === 'en' ? en : zh;
  const plays = ['rush', 'drop'].map((variant, i) => examplePlay(variant, words.look + ' · 0' + (i + 1)));
  const drills = plays.map((play, index) => publishDrill({
    id: 'training-demo-' + (index + 1), title: play.title, role: 'QB', playId: play.id, cameraId: 'qb', targetIds: ['will', 'mike'],
    freezeAt: 0, snapAt: 0.4, replayUntil: 1.8, question: words.question, hint: words.hint, explanation: index === 0 ? words.rush : words.drop,
  }, plays));
  return { drills, plays };
}
