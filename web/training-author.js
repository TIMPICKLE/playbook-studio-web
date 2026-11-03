import { animatedPlayer, escapeHTML as e, uid } from './model.js';
import { drillStatus, normalizeDrill, publishDrill, trainingScene, correctSelection, feedbackTargets } from './training-model.js';
import { createTrainingField } from './training-field.js';
import { authorText } from './locales/training-author.js';

const numeric = new Set(['freezeAt','snapAt','replayUntil','losY']);
const opponentOf = (players, camera) => camera ? players.filter(p => p.side !== camera.side) : [];
const editablePlay = play => !play?.reference && play?.players?.length > 0;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const option = (id, label, selected) => `<option value="${e(id)}"${id === selected ? ' selected' : ''}>${e(label)}</option>`;

function numbered(players) {
  const counts = { offense:0, defense:0 };
  return new Map(players.map(p => [p.id, `${p.side === 'defense' ? 'D' : 'O'}${++counts[p.side]}`]));
}

export function createTrainingAuthor({ root, getData, canEdit, onSave, onBack, getWorkspaceId = () => '', makeField = createTrainingField }) {
  let draft, original, book, dirty = false, pending = false, verified = '', field, previewSelection = [], previewMode, revealed, token = 0;
  let previewVersion = '', reachable, checking = false, checkFailed = false, activeSet = 0;
  const groups = () => [draft.targetIds, ...(draft.alternativeTargetIds || [])];
  const q = selector => root.querySelector(selector);
  const t = () => authorText();
  const allowed = () => typeof canEdit === 'function' ? canEdit() : canEdit === true;
  const scene = () => trainingScene(draft,getData().plays);
  const setMessage = (el,msg) => { if (el) { el.textContent = msg; el.hidden = !msg; } };
  const notice = msg => setMessage(q('[data-ta-error]'), msg);

  function input(key, label, attrs = '', placeholder = '', multiline = false) {
    const value = draft[key] ?? '';
    const props = `name="${key}" ${attrs} placeholder="${e(placeholder)}"`;
    return `<label class="ta-input">${e(label)}${multiline
      ? `<textarea ${props} rows="3">${e(value)}</textarea>`
      : `<input ${props} value="${e(value)}">`}</label>`;
  }
  const select = (key,label,opts) => `<label class="ta-input">${e(label)}<select name="${key}">${opts}</select></label>`;
  const action = (key,label,cls='') => `<button type="button" data-ta="${key}" class="${cls}">${e(label)}</button>`;

  function availableDefense(source) {
    if (!source?.players.some(p => p.side === 'offense')) return [];
    return getData().plays.filter(p => editablePlay(p) && p.id !== source.id && p.players.some(marker => marker.side === 'defense'));
  }
  function defaultCamera() {
    const players = scene()?.players || [];
    const camera = players.find(p => p.label.toUpperCase() === 'QB') || players[0];
    draft.cameraId = camera?.id || '';
    draft.role = camera?.label || '';
    draft.facing = camera?.side === 'defense' ? 'down' : 'up';
  }
  function paintTargets() {
    const a = t(), play = scene(), wrap = q('[data-ta-targets]');
    if (!wrap) return;
    if (!play) { wrap.innerHTML = `<p class="ta-note">${e(a.noScene)}</p>`; return; }
    const players = play.players, camera = players.find(p => p.id === draft.cameraId);
    const ids = numbered(players), sets = groups(), targets = new Set(sets[activeSet]);
    const groupButtons = sets.map((set,i) => `<button type="button" data-ta="set" data-index="${i}" aria-pressed="${i === activeSet}">${e(i ? a.alternative+' '+i : a.primaryAnswer)} · ${set.length}</button>`).join('');
    function marker(p) {
      const point = animatedPlayer(play,p,Number(draft.freezeAt) || 0);
      const pick = camera && p.side !== camera.side;
      const coords = `left:${Math.min(97,Math.max(3,point.x))}%;top:${Math.min(97,Math.max(3,point.y))}%`;
      const selected = targets.has(p.id);
      const title = `${p.label} · ${ids.get(p.id)}${p.name ? ' · '+p.name : ''}`;
      const attrs = `style="${coords}" title="${e(title)}" data-team="${e(p.side)}" class="ta-marker${selected?' is-target':''}${p.id === draft.cameraId?' is-camera':''}"`;
      return pick ? `<button type="button" data-ta="pick" data-marker="${e(p.id)}" aria-label="${e(title)}" aria-pressed="${selected}" ${attrs}>${e(ids.get(p.id))}</button>`
        : `<span aria-hidden="true" ${attrs}>${e(ids.get(p.id))}</span>`;
    }
    const others = opponentOf(players,camera);
    const orphaned = sets[activeSet].filter(id => !others.some(p=>p.id===id));
    wrap.innerHTML = `<h3>${e(a.targets)}</h3><p class="ta-note">${e(a.targetHelp)}</p>
      <div class="ta-sets"><div class="ta-picks" role="group" aria-label="${e(a.answerSets)}">${groupButtons}</div><div class="ta-picks">${sets.length<=5 ? action('add-set',a.addAlternative) : ''} ${activeSet ? action('drop-set',a.dropAlternative) : ''}</div><small class="ta-note">${e(a.setHelp)}</small></div>
      <div role="group" aria-label="${e(a.fieldLabel)}" class="ta-field"><span class="ta-los" style="top:${Number(draft.losY) || 0}%"></span>${players.map(marker).join('')}</div>
      <div class="ta-legend"><span>${e(a.cameraKey)}</span><span>${e(a.key)} · ${targets.size}</span></div>
      <div class="ta-picks">${others.map(p => `<button type="button" data-ta="pick" data-marker="${e(p.id)}" aria-pressed="${targets.has(p.id)}">${e(p.label)} · ${e(ids.get(p.id))}</button>`).join('') || `<p class="ta-note">${e(a.emptyTargets)}</p>`}</div>
      ${orphaned.length ? `<p class="ta-note">${e(a.missingTargets)} ${orphaned.length} ${action('clear-missing',a.clearMissing)}</p>` : ''}`;
  }
  function render() {
    const a=t(), data=getData(), source = data.plays.find(p=>p.id===draft.playId);
    const players = scene()?.players || [], ids = numbered(players), status = original ? drillStatus(original,data.plays) : 'draft';
    const options = (options,selected) => options.map(p => option(p.id,p.title,selected)).join('');
    const defense = availableDefense(source);
    root.innerHTML = `<main class="training-author"><button class="ta-back" type="button" data-ta="back">← ${e(a.back)}</button>
      <div class="ta-kicker">${e(a.lab)}</div><div class="ta-heading"><h1 tabindex="-1">${e(original ? a.edit : a.create)}</h1><span class="ta-badge">${e(a[status])}</span></div>
      <p class="ta-meta">${e(a.intro)}</p>${status === 'needsReview' ? `<p class="ta-alert">${e(a.stale)}</p>` : ''}
      <div class="ta-columns"><section class="ta-panel"><h2>01 · ${e(a.scene)}</h2>
      ${select('playId',a.source,option('',a.noPlay,draft.playId)+(!source && draft.playId ? option(draft.playId,a.missing,draft.playId) : '')+options(data.plays.filter(editablePlay),draft.playId))}
      ${defense.length || draft.defensePlayId ? select('defensePlayId',a.defense,option('',a.same,draft.defensePlayId)+(!defense.some(p=>p.id===draft.defensePlayId) && draft.defensePlayId ? option(draft.defensePlayId,a.missing,draft.defensePlayId) : '')+options(defense,draft.defensePlayId)) : ''}
      ${draft.defensePlayId ? `<label class="ta-check"><input type="checkbox" name="mirrorDefense" ${draft.mirrorDefense ? 'checked':''}>${e(a.mirror)}</label>` : ''}
      <div class="ta-fields">${select('cameraId',a.camera,option('',a.noCamera,draft.cameraId)+players.map(p=>option(p.id,`${p.label} · ${ids.get(p.id)}${p.name ? ' · '+p.name : ''}`,draft.cameraId)).join(''))}${select('facing',a.face,option('up',a.up,draft.facing)+option('down',a.down,draft.facing))}</div>
      <div data-ta-targets></div><details><summary>${e(a.timing)}</summary><p class="ta-note">${e(a.timingHelp)}</p><div class="ta-fields">
      ${[['freezeAt',a.freeze],['snapAt',a.snap],['replayUntil',a.end],['losY',a.los]].map(([key,label])=>input(key,label,`type="number" min="0" max="${key==='losY'?100:20}" step="0.1"`)).join('')}</div></details></section>
      <section class="ta-panel"><h2>02 · ${e(a.copy)}</h2><div class="ta-fields">${input('title',a.title,'maxlength="80"',a.titlePh)}${input('role',a.role,'maxlength="15"')}</div>
      ${input('question',a.question,'maxlength="300"',a.questionPh,true)}${input('hint',a.hint,'maxlength="300"',a.hintPh,true)}${input('explanation',a.explanation,'maxlength="500"',a.explanationPh,true)}
      ${action('preview',verified ? a.previewOK : a.preview)}<p class="ta-note">${e(a.coachCheck)}</p></section></div>
      <div class="ta-actions">${status==='published' ? `<span class="ta-note">${e(a.paused)}</span>` : ''}${action('draft',a.save)}${action('publish',a.publish,'ta-primary')}</div>
      <p role="alert" class="ta-alert" data-ta-error hidden></p><dialog class="training-author-dialog" aria-labelledby="ta-preview-title"></dialog></main>`;
    paintTargets();
  }
  function open({playId,drillId} = {}) {
    close(); root.hidden = false; book=getWorkspaceId();
    if (!allowed()) {
      root.innerHTML=`<main class="training-author">${action('back',t().back,'ta-back')}<p role="status">${e(t().denied)}</p></main>`;
      return;
    }
    const data=getData();
    original = structuredClone(data.drills?.find(d => d.id === drillId) || null);
    if (drillId && !original) { root.innerHTML=`<main class="training-author">${action('back',t().back,'ta-back')}<p>${e(t().conflict)}</p></main>`;return; }
    if (original) draft = structuredClone(original);
    else {
      let source = data.plays.find(p=>p.id===playId);
      const offense=data.plays.find(p=>editablePlay(p) && p.players.some(x=>x.side==='offense'));
      let defense;
      if (source && offense && source.players?.some(p=>p.side==='defense') && !source.players.some(p=>p.side==='offense')) { defense=source; source=offense; }
      if (!source) source=offense || data.plays.find(editablePlay);
      draft=normalizeDrill({id:uid(),playId:source?.id || '',defensePlayId:defense?.id || ''});
      defaultCamera();
    }
    render(); q('h1')?.focus();
  }
  function change(event) {
    const el=event.target,key=el.name;
    if (!draft || !key || !Object.hasOwn(draft,key) || pending) return;
    if (event.type !== (el.tagName === 'SELECT' || el.type==='checkbox' ? 'change' : 'input')) return;
    dirty=true; verified=''; notice('');
    const button=q('[data-ta="preview"]'); if (button) button.textContent=t().preview;
    draft[key]=numeric.has(key) ? (el.value==='' ? null : Number(el.value)) : el.type==='checkbox' ? el.checked : el.value;
    if (['playId','defensePlayId','mirrorDefense','cameraId'].includes(key)) {
      if (key === 'playId') { draft.defensePlayId=''; draft.mirrorDefense=false; }
      if (key === 'defensePlayId') draft.mirrorDefense=false;
      if (key === 'playId' || key === 'defensePlayId') defaultCamera();
      if (key === 'cameraId') {
        const camera=scene()?.players.find(p=>p.id===draft.cameraId);
        draft.role=camera?.label || ''; draft.facing=camera?.side==='defense'?'down':'up';
      }
      draft.targetIds=[]; draft.alternativeTargetIds=[]; activeSet=0; render(); q(`[name="${key}"]`)?.focus();
    } else if (key==='losY' || key==='freezeAt') paintTargets();
  }
  function validated() {
    const a=t();
    if (!['title','role','question','explanation'].every(k=>draft[k]?.trim())) throw Error(a.needFields);
    if (!draft.cameraId || !draft.targetIds.length || !scene()) throw Error(a.needTargets);
    if (![draft.freezeAt,draft.snapAt,draft.replayUntil].every(v=>Number.isFinite(v) && v>=0 && v<=20) || draft.snapAt<draft.freezeAt || draft.snapAt>=draft.replayUntil) throw Error(a.badTimes);
    const sets=groups(), keys=sets.map(set=>JSON.stringify([...set].sort()));
    if (sets.some(set=>set.length!==draft.targetIds.length) || new Set(keys).size!==keys.length) throw Error(a.invalidSets);
    if (!Number.isFinite(draft.losY) || draft.losY<0 || draft.losY>100) throw Error(a.badLos);
    return publishDrill(draft,getData().plays);
  }
  function closePreview() {
    const dlg=q('dialog');
    if (dlg?.open) dlg.close();
    field?.destroy(); field=null; previewVersion=''; reachable=null; checking=false; checkFailed=false;
  }
  function close() {
    token++; closePreview(); root.replaceChildren(); root.hidden=true;
    draft=null; original=null; pending=false; dirty=false; verified=''; activeSet=0;
  }
  function preview() {
    const a=t(), play=scene();
    if (!play?.players.some(p=>p.id===draft.cameraId)) {notice(a.needTargets);return;}
    if (!draft.question.trim()) {notice(a.noPrompt);return;}
    closePreview(); const dlg=q('dialog');
    try { previewVersion=validated().sourceFingerprint; } catch { previewVersion=''; }
    previewSelection=[]; previewMode='pov'; revealed=false; reachable=null;
    dlg.innerHTML=`<header class="ta-preview-head"><h2 id="ta-preview-title">${e(a.preview)}</h2>${action('close-preview',a.close)}</header>
      <p class="ta-preview-copy">${e(draft.question)}</p><div class="ta-preview-field"></div>
      <div class="ta-switches">${action('pov',a.pov)}${action('field',a.field)}${action('reset',a.reset)}${draft.hint ? action('tip',a.tip) : ''}</div>
      <p class="ta-note" data-ta-tip hidden></p><p class="ta-preview-status ta-note" aria-live="polite"></p>
      <p class="ta-note" data-ta-count aria-live="polite"></p><div class="ta-actions">${action('reveal',a.reveal)}${action('accept',a.accept,'ta-primary')}</div>`;
    dlg.showModal();
    dlg.onclose=() => { if (!dlg.open && root.contains(dlg)) { field?.destroy();field=null; } };
    const camera=play.players.find(p=>p.id===draft.cameraId);
    field=makeField({root:q('.ta-preview-field'),play,cameraId:draft.cameraId,direction:draft.facing,losY:draft.losY,
      selectableSide:camera.side==='offense'?'defense':'offense',onPick(id) {
        if (!revealed && id && play.players.some(p=>p.id===id && p.side!==camera.side)) {
          previewSelection=previewSelection.includes(id) ? previewSelection.filter(k=>k!==id) : previewSelection.length<draft.targetIds.length ? [...previewSelection,id] : previewSelection;
          paintPreview();
        }
      },onModeChange(mode) {
        previewMode=mode;
        if (mode==='pov' && field) reachable=field.getReachableIds?.() ?? reachable;
        if (mode==='field' && field && !reachable && !checking && !checkFailed) void checkWithoutWebGL(play);
        updatePreviewPanel();
      }});
    paintPreview(); q('[data-ta="close-preview"]')?.focus();
  }
  async function checkWithoutWebGL(play) {
    const owner = field;
    const {cameraId,facing:direction,losY,freezeAt:time} = draft;
    checking=true;
    try {
      const {createTrainingWorld} = await import('./training-field-pov.js');
      if (field!==owner || !q('dialog')?.open) return;
      const world=createTrainingWorld({play,cameraId,direction,losY});
      try {
        world.resize(16,9);
        world.update({time,selectedIds:[],correctIds:[],revealed:false});
        reachable=world.visibleIds(true);
      } finally { world.dispose(); }
    } catch { if (field===owner) checkFailed=true; }
    finally { if (field===owner) {checking=false;updatePreviewPanel();} }
  }
  function updatePreviewPanel() {
    if (!q('dialog')?.open) return;
    const a=t();
    for (const mode of ['field','pov']) q(`[data-ta="${mode}"]`).setAttribute('aria-pressed',String(previewMode===mode));
    q('[data-ta="reset"]').disabled=previewMode!=='pov';
    q('[data-ta="pov"]').disabled=field?.supportsPOV===false;
    q('[data-ta="reveal"]').disabled=revealed || !draft.targetIds.length || previewSelection.length!==draft.targetIds.length;
    const status=q('.ta-preview-status');
    const blocked=reachable && !groups().some(set=>set.length && set.every(id=>reachable.includes(id)));
    status.textContent=checkFailed ? a.unavailable : checking ? a.unknown : blocked ? a.blocked : revealed ? (correctSelection(draft,previewSelection) ? a.correct : a.wrong)+' · '+draft.explanation : previewMode==='field' ? a.fallback : a.safe;
    q('[data-ta-count]').textContent=`${a.selected} ${previewSelection.length} / ${draft.targetIds.length}`;
    q('[data-ta="accept"]').disabled=!!blocked || !previewVersion || !reachable;
  }
  function paintPreview() {
    field?.setState({mode:previewMode,time:draft.freezeAt,selectedIds:previewSelection,correctIds:revealed?feedbackTargets(draft,previewSelection):[],revealed,picking:!revealed});
    if (previewMode==='pov' && field && !reachable) reachable=field.getReachableIds?.();
    updatePreviewPanel();
  }
  async function save(publish) {
    if (pending || !draft) return;
    if (!allowed()) {notice(t().denied);return;}
    const data=getData();
    if (book!==getWorkspaceId() || !same(original,data.drills?.find(d=>d.id===draft.id) || null)) {notice(t().conflict);return;}
    let next;
    try {
      next=publish ? validated() : normalizeDrill({...draft,status:'draft',sourceFingerprint:''});
      if (publish && next.sourceFingerprint!==verified) {notice(t().previewFirst);preview();return;}
    } catch (err) {notice(err.message);return;}
    const epoch=token;
    pending=true; for (const b of root.querySelectorAll('.ta-actions button')) b.disabled=true;
    try {
      if (await onSave(next)===false) throw Error(t().saveFail);
      if (epoch===token) {close();onBack({saved:true,drillId:next.id});}
    } catch (err) {
      if (epoch===token) {pending=false;for (const b of root.querySelectorAll('.ta-actions button')) b.disabled=false;notice(err.message || t().saveFail);}
    }
  }
  function click(event) {
    const button=event.target.closest('[data-ta]');
    if (!button || !root.contains(button) || pending) return;
    const cmd=button.dataset.ta;
    if (cmd==='back') {
      if (dirty && !root.ownerDocument.defaultView.confirm(t().discard)) return;
      close();onBack({saved:false});return;
    }
    if (!draft) return;
    if (cmd==='pick') {
      const id=button.dataset.marker;
      const set=groups()[activeSet], next=set.includes(id)?set.filter(p=>p!==id):[...set,id];
      const beforeFocus=button.classList.contains('ta-marker') ? '.ta-field' : '.ta-picks';
      if (activeSet===0) draft.targetIds=next; else draft.alternativeTargetIds[activeSet-1]=next;
      dirty=true; verified='';notice('');q('[data-ta="preview"]').textContent=t().preview; paintTargets();
      [...root.querySelectorAll(beforeFocus+' [data-marker]')].find(p=>p.dataset.marker===id)?.focus();
    } else if (cmd==='set' || cmd==='add-set' || cmd==='drop-set' || cmd==='clear-missing') {
      if (cmd==='set') activeSet=Number(button.dataset.index);
      else {
        if (cmd==='add-set') { (draft.alternativeTargetIds ||= []).push([]); activeSet=draft.alternativeTargetIds.length; }
        else if (cmd==='drop-set') { draft.alternativeTargetIds.splice(activeSet-1,1);activeSet=Math.max(0,activeSet-1); }
        else {
          const players=scene()?.players || [], others=opponentOf(players,players.find(p=>p.id===draft.cameraId));
          const remaining=groups()[activeSet].filter(id=>others.some(p=>p.id===id));
          if (activeSet===0) draft.targetIds=remaining; else draft.alternativeTargetIds[activeSet-1]=remaining;
        }
        dirty=true;verified='';notice('');q('[data-ta="preview"]').textContent=t().preview;
      }
      paintTargets();q(`[data-ta="set"][data-index="${activeSet}"]`)?.focus();
    } else if (cmd==='preview') preview();
    else if (cmd==='draft' || cmd==='publish') void save(cmd==='publish');
    else if (cmd==='field' || cmd==='pov') {previewMode=cmd;paintPreview();}
    else if (cmd==='reset') field?.resetLook();
    else if (cmd==='tip') setMessage(q('[data-ta-tip]'),draft.hint);
    else if (cmd==='reveal') {revealed=true;paintPreview();}
    else if (cmd==='accept') {verified=previewVersion;closePreview();q('[data-ta="preview"]').textContent=t().previewOK;notice('');}
    else if (cmd==='close-preview') closePreview();
  }
  root.addEventListener('click',click);
  root.addEventListener('change',change);
  root.addEventListener('input',change);
  return {open,close,isDirty:()=>!!draft && dirty,destroy() {close();root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',change);} };
}
