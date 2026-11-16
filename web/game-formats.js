// League size is a play-level choice. Workspace settings only supply defaults
// for new plays, so a five-player book can still contain an eleven-player play.
export const LEAGUE_SIZES = Object.freeze([5, 6, 7, 8, 9, 11, 12]);
export const TACKLE_FORMATIONS = Object.freeze(['Gun Trips', 'Gun Doubles', 'I Formation', 'Singleback', '4–3', '3–4', 'Nickel', 'Field Goal']);
export const FLAG5_FORMATIONS = Object.freeze({
  offense: Object.freeze(['Flag 5 Spread', 'Flag 5 Trips', 'Flag 5 Bunch']),
  defense: Object.freeze(['Flag 5 Zone', 'Flag 5 Man']),
});
const flagNames = [...FLAG5_FORMATIONS.offense, ...FLAG5_FORMATIONS.defense];
export const BUILT_IN_FORMATIONS = Object.freeze([...TACKLE_FORMATIONS, ...flagNames]);

export function formationOptions(book, count) {
  return count === 5 ? [...FLAG5_FORMATIONS[book === 'defense' ? 'defense' : 'offense']] : [...TACKLE_FORMATIONS];
}

export function defaultFormation(book = 'offense', count = 11) {
  if (count === 5) return FLAG5_FORMATIONS[book === 'defense' ? 'defense' : 'offense'][0];
  return book === 'defense' ? '4–3' : book === 'special' ? 'Field Goal' : 'Gun Trips';
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
  if (!count && play?.book === 'special') count = players.filter(player => player.side === 'defense').length;
  return LEAGUE_SIZES.includes(count) ? count : LEAGUE_SIZES.includes(fallback) ? fallback : 11;
}

export function isFlag5Play(play) {
  // Five remaining markers alone may be an unfinished eleven-player diagram.
  // A flag rules context requires an explicit league or built-in flag formation.
  return play?.league == null ? flagNames.includes(play?.formation) : play.league === 5;
}
