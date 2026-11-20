import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { starterWorkspace, encodeWorkspace, STORAGE_KEY } from '../web/model.js';
import { getFilmPilotVariant, filmPilotEventControls, filmPilotEventTime } from '../web/coach-film-pilot.js';
import { t as translate } from '../web/i18n.js';
import { assignment, answerKey, scoreTrial, summarize } from '../scripts/coach-film-study.mjs';

test('a single explicit pilot arm activates and conventional events use the current canonical clock', () => {
  for (const arm of ['baseline', 'events', 'film', 'lesson']) assert.equal(getFilmPilotVariant('?filmPilot=' + arm), arm);
  for (const raw of ['', '?other=events', '?filmPilot=', '?filmPilot=other', '?filmPilot=events&filmPilot=baseline']) {
    assert.equal(getFilmPilotVariant(raw), null);
  }
  const { plays } = starterWorkspace(), mesh = plays[0];
  assert.equal(filmPilotEventTime(mesh, 'start'), 0);
  assert.equal(filmPilotEventTime(mesh, 'release'), 2);
  mesh.ball.passAt = 2.35;
  assert.match(filmPilotEventControls(mesh), /film-pilot-event:release">[^<]*<span>2\.35s</);
  assert.equal(filmPilotEventTime(mesh, 'release'), 2.35);
  mesh.ball.receiverId = '';
  assert.equal(filmPilotEventTime(mesh, 'release'), null);
  assert.doesNotMatch(filmPilotEventControls(mesh), /film-pilot-event:(release|arrival)/);
  assert.equal(filmPilotEventControls({ ...mesh, reference: { image: 'reference.png' } }), '');
});

test('the events arm works in the ordinary rehearsal without opening the film room or touching the playbook', async t => {
  const win = new Window({ url: 'http://localhost:3000/local.html?filmPilot=events#editor', width: 1440, height: 900 });
  const doc = win.document, data = starterWorkspace();
  data.plays[0].ball.passAt = 2.35;
  const saved = encodeWorkspace(data);
  win.localStorage.setItem(STORAGE_KEY, saved);
  win.localStorage.setItem('playbook-studio:onboarding:v1', JSON.stringify({ dismissed: true, completed: [] }));
  doc.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  const names = ['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous = new Map(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of names) Object.defineProperty(globalThis, key, { configurable: true,
    value: key.endsWith('AnimationFrame') ? win[key].bind(win) : win[key] });
  t.after(async () => {
    win.dispatchEvent(new win.Event('pagehide'));
    await win.happyDOM.abort();
    for (const [key, desc] of previous) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  });
  await import('../web/app.js?test-coach-pilot');
  const button = name => doc.querySelector(`[data-action="${name}"]`);
  assert.equal(button('coach-film'), null);
  button('rehearse-mode').click();
  button('play').click();
  button('film-pilot-event:release').click();
  assert.equal(Number(doc.querySelector('#timeline').value), 2.35);
  assert.equal(doc.querySelector('.playback').classList.contains('is-playing'), false);
  assert.equal(doc.querySelector('#coach-film-room'), null);
  assert.equal(win.localStorage.getItem(STORAGE_KEY), saved);

  await t.test('the assistant Continue button also honours the regular-board assignment', async subtest => {
    const actions = [{ kind: 'dialog_open', dialog: 'coach_film' }];
    const steps = [
      ['read_editor', {}],
      ['preview_actions', { actions }],
      ['submit_result', { result: { kind: 'editor', summary: 'Open the film room', actions } }],
    ];
    subtest.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      const round = JSON.parse(options.body).messages.filter(message => message.role === 'tool').length;
      const [name, args] = steps[round];
      return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: 'pilot-' + round, type: 'function', function: { name, arguments: JSON.stringify(args) },
      }] } }] });
    });
    const waitFor = async selector => {
      const end = Date.now() + 5000;
      while (!doc.querySelector(selector) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(doc.querySelector(selector), selector + ' ' + doc.querySelector('.ba-status').textContent);
      return doc.querySelector(selector);
    };
    const assistant = name => doc.querySelector(`[data-ba="${name}"]`);
    assistant('open').click();
    assistant('settings').click();
    doc.querySelector('[data-ba-key]').value = 'local-test-key';
    assistant('done').click();
    const prompt = doc.querySelector('[data-ba-prompt]');
    prompt.value = '打开战术讲解';
    prompt.dispatchEvent(new win.Event('input', { bubbles: true }));
    assistant('send').click();
    (await waitFor('[data-ba="continue"]')).click();
    assert.equal((await waitFor('.ba-status.ba-error')).textContent, translate('film.openFailed'));
    assert.equal(doc.querySelector('#coach-film-room'), null);
    assert.equal(Number(doc.querySelector('#timeline').value), 2.35);
    assert.equal(win.localStorage.getItem(STORAGE_KEY), saved);
  });
});

test('the actual two plays yield different answers and both roles balance all four task/board orderings', async () => {
  const keyA = await answerKey('A'), keyB = await answerKey('B');
  assert.deepEqual(keyA, { time: 2, deeper: 'H' });
  assert.deepEqual(keyB, { time: 2.35, deeper: 'Y' });
  const observation = { elapsedMs: 30_000, frame: 2.45, deeper: 'Y', evidence: true, prompted: false };
  assert.equal(scoreTrial(observation, keyB).success, true);
  for (const change of [{ elapsedMs: 30_001 }, { frame: 2.45001 }, { frame: null }, { deeper: 'H' }, { evidence: false }, { prompted: true }]) {
    assert.equal(scoreTrial({ ...observation, ...change }, keyB).success, false);
  }
  const sessions = ['C', 'P'].flatMap(role => [1, 2, 3, 4].map(id => {
    const code = role + id;
    const trials = assignment(code).map(({task, mode}) => {
      const key = task === 'A' ? keyA : keyB;
      return { task, mode, frame: key.time, deeper: key.deeper, evidence: true, prompted: false,
        elapsedMs: mode === 'film' ? 15_000 : 20_000 };
    });
    return { code, comparator: 'baseline', trials };
  }));
  assert.equal(new Set(sessions.map(s => s.trials.map(t => t.mode + t.task).join('-'))).size, 4);
  const result = await summarize(sessions, 'baseline');
  assert.equal(result.total, 8);
  assert.equal(result.pairedGain, .25);
  assert.equal(result.decision, 'passes-pilot-task');
  assert.equal(result.conditions.film.cadenceObserved, 0, 'legacy trials omit display observations');
  const trial = sessions[0].trials.find(row => row.mode === 'film');
  Object.assign(trial, { usedPlayback: false, observedStall: true, frameP95Ms: 1001.7 });
  const withCadence = await summarize(sessions, 'baseline');
  assert.equal(withCadence.decision, result.decision);
  assert.deepEqual(withCadence.conditions.film, {
    played: 0, playbackKnown: 1, visibleStalls: 1, cadenceObserved: 1, measuredFrameP95Ms: [1001.7],
  });
  assert.equal((await summarize(sessions.slice(0, 3), 'baseline')).pairedGain, null);
  assert.equal((await summarize(sessions.slice(0, 7), 'baseline')).decision, 'incomplete');
  await assert.rejects(summarize([sessions[0], sessions[0]], 'baseline'));
});
