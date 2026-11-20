import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { frameSummary, sampleClock, stats } from '../scripts/bench-digital/coach/clock.js';
import { sampleDrag, dragSummary } from '../scripts/bench-digital/coach/pointer-trial.js';
import { createScrubPresentation } from '../web/scrub-presentation.js';

test('the downloaded rAF samples reproduce both thresholds and the wall-time share', async () => {
  const ticks = [0,33.3,66.60001,566.5,1066.5,1599];
  let index = 0;
  globalThis.document = Object.assign(new EventTarget(),{hidden:false});
  try {
    const result = await sampleClock(1500,callback => queueMicrotask(() => callback(ticks[index++])),() => {});
    const {raw,...measured} = JSON.parse(JSON.stringify(result));
    assert.deepEqual(raw, ticks.slice(1).map((end,i) => end-ticks[i]));
    assert.deepEqual(frameSummary(raw),measured);
    assert.equal(measured.over33_3msCount,4);
    assert.equal(measured.stall500ms.count,2);
    assert.equal(measured.wallMs,1599);
    assert.equal(measured.stall500ms.totalMs,raw[3]+raw[4]);
    assert.equal(measured.stall500ms.wallPercent,64.57);
  } finally { delete globalThis.document; }
});

test('a visible clock sample exits on an ordinary timer if no display callback is delivered', async () => {
  globalThis.document = Object.assign(new EventTarget(),{hidden:false});
  const cancellations = [];
  try {
    await assert.rejects(sampleClock(100,() => 17,id => cancellations.push(id),5),/did not receive enough rAF/);
    assert.deepEqual(cancellations,[17]);
  } finally { delete globalThis.document; }
});

test('waiting for a physical gesture leaves the event loop idle and ignores untrusted input', async () => {
  const win = new Window(), doc = win.document;
  const range = doc.createElement('input'), pitch = doc.createElement('div');
  range.type = 'range'; pitch.dataset.filmTime = '0'; doc.body.append(range,pitch);
  let frames = 0;
  win.requestAnimationFrame = () => ++frames;
  try {
    const gesture = sampleDrag(range,pitch,{native:true});
    range.dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,pointerId:1}));
    range.dispatchEvent(new win.Event('input',{bubbles:true}));
    await new Promise(resolve => win.setTimeout(resolve,10));
    assert.equal(frames,0);
    Object.defineProperty(doc,'hidden',{configurable:true,value:true});
    doc.dispatchEvent(new win.Event('visibilitychange'));
    await assert.rejects(gesture,/hidden during the drag/);
  } finally { await win.happyDOM.abort(); }
});

test('the continuous drag sends multiple values per frame and flushes the final pointer value', async () => {
  const win = new Window(), doc = win.document;
  const range = doc.createElement('input');
  range.type = 'range'; range.min = '0'; range.max = '6'; range.step = '0.01';
  const pitch = doc.createElement('div');
  pitch.dataset.filmTime = '0';
  doc.body.append(range,pitch);
  win.requestAnimationFrame = callback => win.setTimeout(() => callback(win.performance.now()),90);
  win.cancelAnimationFrame = id => win.clearTimeout(id);
  let renderedAtRelease;
  const scrub = createScrubPresentation(win,() => {pitch.dataset.filmTime = range.value;});
  range.addEventListener('input',() => scrub.queue());
  range.addEventListener('pointerup',() => {scrub.flush(); renderedAtRelease = pitch.dataset.filmTime;});
  try {
    const raw = await sampleDrag(range,pitch,{count:16,periodMs:1});
    const summary = dragSummary(raw,stats);
    assert.equal(summary.source,'scripted-pointer-and-range');
    assert.equal(summary.trusted,false);
    assert.equal(summary.inputCount,16);
    assert.equal(summary.moveCount,16);
    assert.ok(summary.rafObservedCount < summary.inputCount);
    assert.ok(summary.fieldCommitCount < summary.inputCount);
    assert.equal(summary.final.time,Number(renderedAtRelease));
    assert.equal(summary.final.time,Number(range.value));
    assert.ok(raw.downAtMs <= raw.inputs[0].atMs);
    assert.ok(raw.upAtMs >= raw.inputs.at(-1).atMs);
    assert.ok(raw.inputs.at(-1).commitAtMs <= raw.inputs.at(-1).rafAtMs);
  } finally { scrub.cancel(); await win.happyDOM.abort(); }
});
