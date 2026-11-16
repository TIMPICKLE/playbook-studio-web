import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, animatedBall, animatedPlayer, clone, decodeWorkspace, encodeWorkspace, formationPlayers, makePlay, starterWorkspace, validatePlay } from '../web/model.js';
import { FLAG5_FORMATIONS, LEAGUE_SIZES, defaultFormation, formationOptions, getPlayLeague, isFlag5Play, resolveFormation } from '../web/game-formats.js';
import { EditorPlayOperationSchema, runEditorPlayCommand } from '../web/editor-play-commands.js';
import { getEditorOverview, parseEditorActions, prepareEditorActions } from '../web/editor-actions.js';

const execute = (play, operation, options) => {
  const draft = clone(play);
  runEditorPlayCommand(draft, operation, options);
  return validatePlay(draft);
};

test('flag formations create five eligible-role markers rather than a truncated tackle line', () => {
  assert.deepEqual(LEAGUE_SIZES, [5, 6, 7, 8, 9, 11, 12]);
  for (const book of ['offense', 'defense']) {
    for (const formation of FLAG5_FORMATIONS[book]) {
      const play = makePlay({ count: 5, book, formation });
      assert.equal(play.league, 5);
      assert.equal(play.formation, formation);
      assert.equal(play.players.length, 5);
      assert.equal(new Set(play.players.map(player => player.id)).size, 5);
      assert.deepEqual(play.players.map(player => player.label), book === 'offense' ? ['C', 'QB', 'X', 'Y', 'Z'] : ['R', 'LCB', 'RCB', 'S', 'DB']);
      assert.ok(play.players.every(player => player.side === book));
      assert.equal(play.routes.length, 0, 'flag templates do not insert tackle blocking');
      assert.equal(isFlag5Play(play), true);
      assert.deepEqual(validatePlay(play), play);
    }
  }
  assert.equal(resolveFormation('4-3', 'defense', 5), 'Flag 5 Zone');
  assert.equal(makePlay({count:5}).formation, 'Flag 5 Trips');
  assert.equal(defaultFormation('defense', 5), 'Flag 5 Zone');
  assert.deepEqual(formationOptions('offense', 5), FLAG5_FORMATIONS.offense);
  assert.ok(!formationOptions('special', 5).includes('Field Goal'));
  assert.equal(formationPlayers('Gun Trips', 1).length, 1, 'partial low-level diagrams remain supported');
});

test('play league survives JSON import, mixed-format books and custom saved formations', () => {
  const workspace = starterWorkspace();
  const original = clone(workspace.plays);
  const flag = makePlay({title:'Flag offense', count:5, formation:'Flag 5 Spread'});
  workspace.plays.push(flag);
  workspace.settings.league = 5;
  workspace.formations.push({id:'flag-custom', name:'Team Flag', book:'offense', league:5, players:clone(flag.players)});
  const restored = decodeWorkspace(encodeWorkspace(workspace));
  assert.deepEqual(restored.plays.slice(0, -1), original);
  assert.equal(restored.plays.at(-1).league, 5);
  assert.equal(restored.formations[0].league, 5);
  assert.equal(restored.settings.league, 5);
  const invalid = clone(workspace); invalid.plays.at(-1).league = 10;
  assert.throws(() => decodeWorkspace(encodeWorkspace(invalid)), /人数/);
});

test('legacy sizes infer safely while five remaining markers alone do not declare flag rules', () => {
  const legacy = makePlay(); delete legacy.league;
  assert.equal(getPlayLeague(legacy, 5), 11);
  legacy.players = legacy.players.slice(0, 5);
  assert.equal(getPlayLeague(legacy), 5);
  assert.equal(isFlag5Play(legacy), false);
  const oldFlag = makePlay({count:5}); delete oldFlag.league;
  assert.equal(getPlayLeague(oldFlag), 5);
  assert.equal(isFlag5Play(oldFlag), true);
  assert.equal(getPlayLeague({reference:{}, players:[]}, 5), 11);
  const workspace = starterWorkspace();
  for (const play of workspace.plays) delete play.league;
  assert.deepEqual(decodeWorkspace(encodeWorkspace(workspace)).plays, workspace.plays);
});

test('common editor schemas accept five and oppose using the play size rather than workspace defaults', () => {
  assert.ok(EditorPlayOperationSchema.safeParse({kind:'formation_apply', formation:'Flag 5 Spread', count:5}).success);
  assert.ok(EditorPlayOperationSchema.safeParse({kind:'opponents_set', enabled:true, count:5}).success);
  assert.ok(!EditorPlayOperationSchema.safeParse({kind:'opponents_set', enabled:true, count:10}).success);
  assert.equal(parseEditorActions([{kind:'play_create', title:'Flag', book:'defense', formation:'Flag 5 Man', count:5}])[0].count, 5);
  const flag = makePlay({count:5, formation:'Flag 5 Spread'});
  const both = execute(flag, {kind:'opponents_set', enabled:true});
  assert.deepEqual(both.players.filter(player => player.side === 'offense'), flag.players);
  assert.deepEqual(both.players.filter(player => player.side === 'defense').map(player => player.label), ['R','LCB','RCB','S','DB']);
  assert.equal(both.players.length, 10);
  assert.deepEqual(execute(both, {kind:'opponents_set', enabled:true}), both);
  assert.deepEqual(execute(both, {kind:'opponents_set', enabled:false}), flag);
  const legacy = makePlay(); delete legacy.league;
  assert.equal(execute(legacy, {kind:'opponents_set', enabled:true}).players.length, 22);
  const paired = execute(makePlay(), {kind:'opponents_set', enabled:true});
  const legacyDefense = execute(paired, {kind:'formation_apply', formation:'4–3'});
  assert.equal(legacyDefense.players.length, 11, 'legacy cross-unit replacement does not duplicate existing defenders');
  assert.ok(legacyDefense.players.every(player => player.side === 'defense'));
});

test('changing the flag offense formation preserves the existing defense and its movement', () => {
  const flag = execute(makePlay({count:5}), {kind:'opponents_set', enabled:true});
  addRoute(flag, 'R', [[50, 40]]);
  addRoute(flag, 'X', [[72, 40]]);
  flag.zones.push({id:'coverage', x:50, y:35, rx:20, ry:10, color:'#88bfff', label:'Zone'});
  flag.annotations.push({id:'cue', x:15, y:20, text:'Read rusher'});
  const defenders = clone(flag.players.filter(player => player.side === 'defense'));
  const defenseRoute = clone(flag.routes.find(route => route.playerId === defenders[0].id));
  const changed = execute(flag, {kind:'formation_apply', formation:'Flag 5 Bunch'});
  assert.equal(changed.league, 5);
  assert.equal(changed.formation, 'Flag 5 Bunch');
  assert.equal(changed.players.length, 10);
  assert.deepEqual(changed.players.filter(player => player.side === 'defense'), defenders);
  assert.deepEqual(changed.routes, [defenseRoute]);
  assert.deepEqual(changed.zones, flag.zones);
  assert.deepEqual(changed.annotations, flag.annotations);
  assert.ok(changed.players.some(player => player.id === changed.ball.holderId && player.label === 'QB'));
});

test('the flag center can run a receiving route and catch the rehearsal pass', () => {
  const play = makePlay({count:5, formation:'Flag 5 Spread'});
  const center = play.players.find(player => player.label === 'C');
  addRoute(play, 'C', [[50, 55], [65, 48]], 'route', {duration:4});
  play.ball.receiverId = center.id;
  validatePlay(play);
  assert.notDeepEqual(animatedPlayer(play, center, 2), {x:center.x, y:center.y});
  assert.deepEqual(animatedBall(play, play.ball.arriveAt), animatedPlayer(play, center, play.ball.arriveAt));
});

test('applying a flag defensive template retains the offense and its passing assignments', () => {
  const defense = execute(makePlay({count:5, book:'defense'}), {kind:'opponents_set', enabled:true});
  const offense = clone(defense.players.filter(player => player.side === 'offense'));
  const quarterback = offense.find(player => player.label === 'QB');
  const receiver = offense.find(player => player.label === 'X');
  defense.ball.holderId = quarterback.id; defense.ball.receiverId = receiver.id;
  addRoute(defense, 'X', [[25, 40]]);
  defense.zones.push({id:'old-zone', x:50, y:35, rx:20, ry:10, color:'#88bfff', label:'Old responsibility'});
  const changed = execute(defense, {kind:'formation_apply', formation:'Flag 5 Man'});
  assert.equal(changed.players.length, 10);
  assert.deepEqual(changed.players.filter(player => player.side === 'offense'), offense);
  assert.deepEqual(changed.routes, defense.routes);
  assert.deepEqual(changed.ball, defense.ball);
  assert.deepEqual(changed.zones, [], 'replaced defenders do not keep their previous coverage zones');
});

test('a saved five-plus-five template reuses only its home side when opponents already exist', () => {
  const data = starterWorkspace();
  const both = execute(makePlay({count:5}), {kind:'opponents_set', enabled:true});
  data.plays.push(both);
  const saved = prepareEditorActions({data, selectedId:both.id}, [{kind:'formation_save', name:'Flag pair'}]);
  const formation = saved.data.formations.at(-1);
  assert.equal(formation.league, 5);
  assert.equal(formation.players.length, 10);
  const current = execute(makePlay({count:5, formation:'Flag 5 Bunch'}), {kind:'opponents_set', enabled:true});
  const defenders = clone(current.players.filter(player => player.side === 'defense'));
  const applied = execute(current, {kind:'formation_apply', formationId:formation.id}, {formations:[formation]});
  assert.equal(applied.players.length, 10);
  assert.deepEqual(applied.players.filter(player => player.side === 'defense'), defenders);
  const fresh = execute(makePlay({count:5}), {kind:'formation_apply', formationId:formation.id}, {formations:[formation]});
  assert.equal(fresh.players.length, 10, 'without existing opponents the saved paired diagram remains available');
  const reused = prepareEditorActions({data:saved.data, selectedId:both.id}, [{kind:'play_create', title:'Paired flag', book:'offense', formation:'custom:' + formation.id, count:5}]);
  assert.equal(reused.data.plays.at(-1).players.length, 10);
  assert.equal(reused.data.plays.at(-1).league, 5);
});

test('AI workspace creation and saved-formation reuse preserve flag intent and existing tackle plays', () => {
  const data = starterWorkspace();
  const existing = clone(data.plays);
  const created = prepareEditorActions({data, selectedId:data.plays[0].id}, [{kind:'play_create', title:'Flag concept', book:'offense', formation:'Gun Doubles', count:5}], {locale:'en'});
  assert.deepEqual(created.data.plays.slice(0, -1), existing);
  const flag = created.data.plays.at(-1);
  assert.equal(flag.formation, 'Flag 5 Spread');
  assert.equal(flag.league, 5);
  assert.equal(flag.personnel, '5v5 Flag');
  const saved = prepareEditorActions({data:created.data, selectedId:flag.id}, [{kind:'formation_save', name:'My flag formation'}]);
  assert.equal(saved.data.formations.at(-1).league, 5);
  const template = saved.data.formations.at(-1);
  const reused = prepareEditorActions({data:saved.data, selectedId:flag.id}, [{kind:'play_create', title:'Flag reuse', book:'offense', formation:'custom:' + template.id, count:5}]);
  assert.equal(reused.data.plays.at(-1).league, 5);
  assert.equal(reused.data.plays.at(-1).formation, template.name);
  assert.equal(isFlag5Play(reused.data.plays.at(-1)), true);
  const overview = getEditorOverview(reused.data, reused.selectedId);
  assert.ok(overview.formations.builtIn.includes('Flag 5 Zone'));
  assert.equal(overview.plays.at(-1).league, 5);
  assert.deepEqual(decodeWorkspace(encodeWorkspace(reused.data)), reused.data);
});

test('reusing a custom flag formation preserves its name even when it matches a tackle preset', () => {
  const data = starterWorkspace();
  const source = makePlay({count:5, formation:'Flag 5 Spread'});
  data.formations.push({id:'coach-template', name:'Gun Trips', book:'offense', league:5, players:clone(source.players)});
  const plan = prepareEditorActions({data, selectedId:data.plays[0].id}, [{kind:'play_create', title:'Coach layout', book:'offense', formation:'custom:coach-template', count:5}]);
  const reused = plan.data.plays.at(-1);
  assert.equal(reused.formation, 'Gun Trips');
  assert.equal(reused.league, 5);
  assert.equal(isFlag5Play(reused), true);
  assert.deepEqual(reused.players.map(({id, ...player}) => player), source.players.map(({id, ...player}) => player));
});
