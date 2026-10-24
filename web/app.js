import { createMaddenLibrary } from './madden.js';
import { makeMaddenPlay } from './madden-model.js';
import { feedback, feedbackBox } from './ui.js';
import { SharedWorkspace, cloudMode, CLOUD_SITE } from './cloud.js';
import { BOOKS, COLORS, FORMATIONS, STORAGE_KEY, clone, uid, clamp, escapeHTML as e, starterWorkspace, makePlay, formationPlayers, mirrorPlay, movePlayer, animatedPlayer, animationLength, encodeWorkspace, decodeWorkspace, History } from './model.js';
import { fieldSVG, updateAnimation, updateGeometry, previewDraft } from './field.js';
import { enterContext, enterPlayers, revealPlay, enterWorkbench } from './motion.js';
import { effectsControl, initEffects, burstAt } from './effects.js';
import { createBoardLayout, boardSizeControls, boardHeightHandle, boardWidthHandle } from './board-layout.js';

const $ = selector => document.querySelector(selector);
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM20 4h-4a3 3 0 0 0-3 3M13 21a4 4 0 0 1 4-2h3V4"/>', select: '<path d="m5 3 14 10-7 1-3 7z"/>', route: '<path d="M5 20V7h14m-5-5 5 5-5 5"/>', block: '<path d="M5 20V7h14M19 2v10"/>', motion: '<path d="m4 20 3-5-3-5 3-5h13m-5-4 5 4-5 4"/>', pass: '<path stroke-dasharray="2 4" d="M4 19 19 4"/><path d="M12 4h7v7"/>', zone: '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 3"/>', text: '<path d="M4 5h16M12 5v15M8 20h8"/>', flip: '<path d="M12 3v18M8 8l-5 4 5 4M16 8l5 4-5 4"/>', undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>', redo: '<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>', export: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>', print: '<path d="M7 7V3h10v4M7 17H3V8h18v9h-4M7 14h10v7H7z"/>', star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3.2 9.7l6.4-.9z"/>', play: '<path d="m8 4 13 8-13 8z"/>', pause: '<path d="M8 4v16M16 4v16"/>', reset: '<path d="M4 8V3m0 5h5M4 8a9 9 0 1 1-1 7"/>', loop: '<path d="m17 2 4 4-4 4M3 10V6h18M7 22l-4-4 4-4M21 14v4H3"/>', trash: '<path d="M4 6h16M9 6V3h6v3M7 6l1 15h8l1-15M10 10v7M14 10v7"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', chevron: '<path d="m9 5 7 7-7 7"/>', team: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 6"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01"/>', check: '<path d="m5 12 4 4L19 6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/>', grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>', save: '<path d="M5 3h13l3 3v15H3V3zM7 3v7h10V3M7 21v-7h10v7"/>', folder: '<path d="M3 6h7l2 3h9v12H3z"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', ball: '<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/><path d="m8 15 8-6M9 11l3 3M12 8l3 3"/>', flag: '<path d="M5 21V3h14l-3 5 3 5H5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.route}</svg>`;
const btn = (action, name, label, cls = '', attrs = '') => `<button type="button" data-action="${action}" class="${cls}" title="${e(label)}" aria-label="${e(label)}" ${attrs}>${icon(name)}</button>`;
let loadIssue = '';
let workspace;
try { const raw = localStorage.getItem(STORAGE_KEY); workspace = raw ? decodeWorkspace(raw) : starterWorkspace(); }
catch { workspace = starterWorkspace(); loadIssue = '已有保存文件无法读取，已载入示例。原文件仍保留，请先导出备份后再编辑。'; }
let state = { data: workspace, selectedId: workspace.plays[0].id };
let book = workspace.plays[0].book, query = '', filter = '', formationFilter = '', tool = 'select', selection = null, draft = null, drag = null, playing = false, time = 0, speed = 1, loop = false, sidebarOpen = false;
let saveState = loadIssue ? '恢复提醒' : '本地已保存', frame = null, lastFrame = null, toastTimer = null;
const history = new History();
let shared = null;
let pendingNavigation = null, viewOverrides = {}, renderedPlayId = null, gestureFrame = null, pendingPoint = null, previewPoint = null, rehearsal = false;
const drawingTools = ['route','block','motion','pass'];
const boardLayout = createBoardLayout({ notify: message => toast(message), hasDraft: () => !!draft });
const viewSettings = () => ({ ...state.data.settings, ...viewOverrides });
const canEdit = () => !cloudMode() || !!shared?.canEdit;
const readActions = new Set(['madden-library','choose','book','select-route','clear-selection','sidebar','export','print','help','close-modal','download-svg','download-png','download-json','download-play','do-print','play','reset','loop','grid','theme','clear-filters','keep-drawing','edit-mode','rehearse-mode']);
function protectReadOnly() {
  if (canEdit()) return;
  document.querySelectorAll('[data-prop],[data-ball],#apply-formation').forEach(n => { n.disabled = true; });
  document.querySelectorAll('#app [data-action]').forEach(n => { const [action,value]=n.dataset.action.split(':'); if (!readActions.has(action) && !(action==='tool' && value==='select')) n.disabled=true; });
}
const current = () => state.data.plays.find(p => p.id === state.selectedId) || state.data.plays[0];
const filtered = () => state.data.plays.filter(p => p.book === book && (!filter || (filter === 'favorite' ? p.favorite : p.category === filter)) && (!formationFilter || p.formation === formationFilter) && `${p.title} ${p.formation} ${p.category} ${p.notes}`.toLowerCase().includes(query.toLowerCase()));
const selectedObject = () => !selection ? null : current()[{ player: 'players', route: 'routes', zone: 'zones', annotation: 'annotations' }[selection.type]]?.find(x => x.id === selection.id);
const maddenLibrary = createMaddenLibrary({ canEdit, getPlays: () => state.data.plays, notify: toast, onImport(entry) {
  if (!canEdit()) { toast('当前为只读权限。', { type: 'warning' }); return; }
  if (!confirmDraft(() => importMadden(entry))) return;
  return importMadden(entry);
} });
function importMadden(entry) {
  if (!canEdit()) return;
  if (state.data.plays.some(p => p.reference?.catalogId === entry.id)) { toast('这条战术已经在当前战术本中。', { type: 'success' }); return; }
  if (state.data.plays.length >= 500) return { ok: false, message: '战术本最多 500 个战术，请先整理后再加入。' };
  const play = makeMaddenPlay(entry);
  book = 'offense'; filter = ''; formationFilter = ''; query = ''; selection = null; tool = 'select';
  edit((p, data) => { data.plays.push(play); state.selectedId = play.id; });
  const checkpoint = history.past.at(-1);
  return { ok: true, canUndo: () => canEdit() && history.past.at(-1) === checkpoint,
    undo: () => { if (canEdit() && history.past.at(-1) === checkpoint) restore(history.undo(state)); },
    view: () => { choose(play.id); const card = document.querySelector(`[data-action="choose:${play.id}"]`); card?.scrollIntoView?.({ block: 'nearest' }); $('#main-content')?.focus(); }
  };
}
function protectReference() {
  if (!current().reference) return;
  document.querySelectorAll('[data-action="mirror"],[data-action="rehearse-mode"],[data-action="play"]').forEach(n => { n.disabled = true; n.title = '原始战术图没有可编辑或播放的坐标'; });
}

function toast(message, { type = 'info', action = '', label = '' } = {}) {
  const node = $('#toast'), undoable = /可撤销|撤销恢复/.test(message) && history.past.length && canEdit();
  node.dataset.type = type; node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const symbol = type === 'success' ? icon('check') : type === 'error' ? '!' : type === 'warning' ? '⚠' : 'i';
  node.innerHTML = `<span class="toast-icon" aria-hidden="true">${symbol}</span><span>${e(message)}</span>${undoable ? '<button data-action="undo" class="toast-undo">撤销</button>' : ''}${action ? `<button data-action="${e(action)}" class="toast-action">${e(label)}</button>` : ''}<button class="toast-close" data-action="dismiss-toast" aria-label="关闭提示">${icon('close')}</button>`;
  node.classList.add('visible'); window.clearTimeout(toastTimer);
  if (type !== 'error') toastTimer = window.setTimeout(() => node.classList.remove('visible'), type === 'warning' ? 8000 : 5200);
}

function save() {
  if (cloudMode()) { shared?.schedule(state.data); return; }
  try { localStorage.setItem(STORAGE_KEY, encodeWorkspace(state.data)); saveState = '本地已保存'; }
  catch { saveState = '尚未保存'; toast('保存失败：浏览器存储不可用或已满，请导出 JSON 保存战术本。', { type: 'error', action: 'download-json', label: '导出备份' }); }
  $('#save-state')?.replaceChildren(document.createTextNode(saveState));
}
function stop() { playing = false; if (frame) cancelAnimationFrame(frame); frame = null; lastFrame = null; }
function resetAnimation() { stop(); time = 0; }
function edit(fn, { redraw = true } = {}) {
  if (!canEdit()) { toast('当前为只读权限，无法修改共享战术。', { type: 'warning' }); return; }
  resetAnimation(); rehearsal = false; draft = null; previewPoint = null; history.record(state); fn(current(), state.data); save(); if (redraw) render(); else refreshMetadata();
}
function choose(id) { if(id===state.selectedId)return; if (!confirmDraft(() => choose(id))) return; resetAnimation(); draft = null; selection = null; state.selectedId = id; sidebarOpen = false; tool = 'select'; render(); }
function restore(next) { if (!next || !canEdit()) return; resetAnimation(); rehearsal=false; state = next; book = current().book; selection = null; draft = null; save(); render(); $('#toast').classList.remove('visible'); }

function render() {
  const p = current(); if (!p) return;
  const previousPlay=renderedPlayId, existingIds=new Set([...document.querySelectorAll('#field [data-player]')].map(n=>n.dataset.player));
  const scrolls=['.sidebar','.play-list','.inspector'].map(selector=>[selector,$(selector)?.scrollTop||0]);
  if (!cloudMode()) document.title = `${p.title} · 本地预览`;
  document.documentElement.style.setProperty('--team-color', state.data.team.accent);
  document.title = `${p.title} · Playbook Studio`;
  const plays = filtered(), categories = [...new Set(state.data.plays.filter(p => p.book === book).map(p => p.category))];
  const formations = [...new Set(state.data.plays.filter(p => p.book === book).map(p => p.formation))];
  $('#app').innerHTML = `<div class="workspace ${p.reference ? 'reference-play' : ''} ${sidebarOpen ? 'sidebar-open' : ''}">
    <button class="sidebar-scrim" data-action="sidebar" aria-label="关闭战术列表"></button><aside class="sidebar" aria-label="战术列表">
      <a class="brand" href="./index.html" aria-label="Playbook Studio"><img src="./assets/stingers-mark.png" alt="" width="34" height="34"><span>STINGERS<span>PLAYBOOK STUDIO</span></span><small>${cloudMode() ? '共享' : '本地'}</small></a>
      <button class="team-switch" data-action="team"><span class="team-avatar"><img src="./assets/stingers-mark.png" alt="STINGERS" width="34" height="34"></span><span><strong>${e(state.data.team.name)}</strong><small>${e(state.data.team.subtitle)}</small></span>${icon('chevron')}</button>
      <div class="side-label">WORKSPACE <span>战术本</span></div>
      <nav class="book-nav" aria-label="战术本类型">${Object.entries(BOOKS).map(([key, name]) => `<button ${key === 'offense' ? 'data-madden-drop="offense"' : ''} data-action="book:${key}" class="${key === book ? 'active' : ''}" aria-pressed="${key === book}">${icon(key === 'offense' ? 'route' : key === 'defense' ? 'zone' : 'flag')}<span>${name}</span><em>${state.data.plays.filter(p => p.book === key).length}</em></button>`).join('')}</nav>
      <button class="madden-launch" data-action="madden-library">${icon('ball')}<span><strong>Madden NFL 战术库</strong><small>Eagles · Ravens · 拖入即用</small></span><b>↗</b></button>
      <div class="madden-drop-target" data-madden-drop="offense">＋ 拖到这里，加入进攻战术本<small>${canEdit() ? '加入当前工作区 · 自动保存' : '当前只读，无法加入'}</small></div>
      <div class="side-divider"></div>
      <label class="search-box">${icon('search')}<input type="search" id="search" placeholder="搜索战术…" aria-label="搜索战术" value="${e(query)}"></label>
      <div class="filters"><select aria-label="战术分类" id="category-filter"><option value="">全部分类</option><option value="favorite" ${filter === 'favorite' ? 'selected' : ''}>★ 已收藏</option>${categories.map(c => `<option value="${e(c)}" ${c === filter ? 'selected' : ''}>${e(c)}</option>`).join('')}</select><select aria-label="阵型筛选" id="formation-filter"><option value="">全部阵型</option>${formations.map(f => `<option value="${e(f)}" ${formationFilter === f ? 'selected' : ''}>${e(f)}</option>`).join('')}</select></div>
      <div class="play-list-label"><span>${filter === 'favorite' ? '收藏的战术' : '我的战术'} <b>${plays.length}</b></span>${btn('new', 'plus', '新建战术', 'small-icon')}</div>
      <div class="play-list">${plays.length ? plays.map((v, i) => `<button data-action="choose:${e(v.id)}" class="play-card ${p.id === v.id ? 'active' : ''}" aria-label="打开 ${e(v.title)}" aria-pressed="${p.id === v.id}"><div class="play-thumb">${fieldSVG(v, { showGrid: false }, { thumbnail: true, prefix: `thumb-${i}` })}</div><span class="play-card-info"><strong>${e(v.title)}</strong><small>${e(v.formation)} · ${e(v.category)}</small></span>${v.favorite ? '<span class="favorite-dot">★</span>' : ''}</button>`).join('') : '<div class="empty-list">没有找到匹配战术。<br>试试其他关键词或清除筛选。<button class="text-button" data-action="clear-filters">清除全部筛选</button></div>'}</div>
      <button class="new-play" data-action="new">${icon('plus')} 新建战术</button>
      <div class="sidebar-bottom"><button data-action="team">${icon('team')} 球队与名单</button><button data-action="import">${icon('folder')} 导入战术本</button><button data-action="help">${icon('help')} 使用指南 <kbd>?</kbd></button><span class="local-status"><i></i><span id="save-state">${e(saveState)}</span></span></div>
    </aside>
    <main class="main" id="main-content" tabindex="-1">
      <header class="topbar"><div class="breadcrumbs">${btn('sidebar', 'menu', '打开或关闭战术列表', 'mobile-menu', `aria-expanded="${sidebarOpen}"`)}<span>${icon('book')} ${BOOKS[p.book]}战术本</span><span class="crumb-slash">/</span><span>${e(p.formation)}</span></div><div class="top-actions"><button class="button subtle" data-action="madden-library">${icon('ball')}<span>Madden 战术库</span></button>${effectsControl()}<button class="button subtle" data-action="print">${icon('print')}<span>打印</span></button><button class="button primary" data-action="export">${icon('export')}<span>导出</span></button></div></header>
      <section class="play-header"><div><div class="eyebrow">${e(p.personnel)} <span>·</span> ${e(p.category)}</div><h1>${e(p.title)} ${btn('favorite', 'star', p.favorite ? '取消收藏' : '收藏战术', `favorite-button ${p.favorite ? 'is-favorite' : ''}`)}</h1><p>${p.reference ? 'Madden 原始战术图 · 可收藏、记录笔记、导出与打印。' : canEdit() ? '选择球员画路线，或直接拖动调整站位。' : '查看团队战术，播放演练并学习自己的跑位。'}</p></div><div class="play-actions">${btn('undo', 'undo', '撤销 · Ctrl+Z', 'icon-button', !history.past.length ? 'disabled' : '')}${btn('redo', 'redo', '重做 · Ctrl+Shift+Z', 'icon-button', !history.future.length ? 'disabled' : '')}<span class="vertical-rule"></span>${btn('mirror', 'flip', '左右镜像', 'icon-button')}${btn('duplicate', 'copy', '复制战术', 'icon-button')}</div></section>
      ${!canEdit() ? '<div class="readonly-banner"><strong>只读模式</strong><span>你可以查看、演练、导出和打印。需要修改时，请联系管理员调整权限。</span></div>' : ''}<div class="editor-layout"><section class="canvas-section" aria-label="球场与演练">
        <div class="canvas-heading"><div class="editor-mode" role="group" aria-label="工作模式"><button data-action="edit-mode" aria-pressed="${!rehearsal}" class="${!rehearsal?'active':''}">${icon('select')}布阵与画线</button><button data-action="rehearse-mode" aria-pressed="${rehearsal}" class="${rehearsal?'active':''}">${icon('play')}战术演练</button></div><div class="view-tools" role="group" aria-label="球场视图选项">${btn('grid', 'grid', '显示或隐藏码线', `tool-button ${viewSettings().showGrid ? 'enabled' : ''}`)}${btn('theme', 'sun', '切换球场明暗', 'tool-button')}</div><details class="add-object-menu"><summary>＋ 添加对象</summary><div><button data-action="add-player:offense">${icon('plus')}添加进攻球员</button><button data-action="add-player:defense">${icon('plus')}添加防守球员</button><button data-action="add-defense-43" title="4 名锋线 · 3 名线卫 · 4 名后卫">${icon('team')}${p.players.some(v => v.side === 'defense') ? '重设' : '添加'} 4–3 防守阵型（11 人）<small>4 名锋线 · 3 名线卫 · 4 名后卫</small></button><button data-action="tool:zone">${icon('zone')}绘制防守区域</button><button data-action="tool:text">${icon('text')}添加文字标注</button></div></details></div>
        <div class="toolbar" role="toolbar" aria-label="绘图工具"><div class="draw-tools" style="--tool-index:${['select','route','block','motion','pass','zone','text'].indexOf(tool)}"><span class="tool-indicator" aria-hidden="true"></span>${[['select', 'select', '选择 / 移动 · V'], ['route', 'route', '路线 · R'], ['block', 'block', '阻挡 · B'], ['motion', 'motion', '开球前移动 · M'], ['pass', 'pass', '传球线 · P'], ['zone', 'zone', '防守区域 · Z'], ['text', 'text', '文字标注 · T']].map(([a, i, l]) => `<button class="tool-button ${tool === a ? 'active' : ''}" data-action="tool:${a}" title="${e(l)}" aria-label="${e(l)}" aria-pressed="${tool === a}">${icon(i)}<span class="tool-name">${({select:'选择',route:'跑动',block:'阻挡',motion:'移动',pass:'传球',zone:'区域',text:'文字'})[a]}</span><kbd>${l.split(' · ')[1]}</kbd></button>`).join('')}</div></div>
        ${boardSizeControls()}
        <div id="field" class="field-wrap tool-${tool} ${rehearsal ? 'is-rehearsal' : ''}">${fieldSVG(p, viewSettings(), { selected: selection, time, drawing: draft })}<div class="field-tag">${icon('ball')} <span>${p.players.filter(v => v.side === 'offense').length} O / ${p.players.filter(v => v.side === 'defense').length} D</span></div><div id="field-context" class="field-context">${fieldContext()}</div><div class="drag-readout" hidden></div></div>
        ${boardHeightHandle}
        <div class="canvas-hint" aria-live="polite">${canvasHint()}</div>
        <div class="playback"><div class="playback-top"><div class="playback-title">${icon('play')}<span>战术演练</span><small id="playback-phase">${playbackPhase()}</small></div><div class="playback-options"><label class="speed-label">速度 <select id="speed" aria-label="播放速度">${[.5, 1, 1.5, 2].map(s => `<option value="${s}" ${s === speed ? 'selected' : ''}>${s}×</option>`).join('')}</select></label>${btn('loop', 'loop', '循环播放', `icon-button ${loop ? 'enabled' : ''}`, `aria-pressed="${loop}"`)}</div></div><div class="transport">${btn('play', playing ? 'pause' : 'play', playing ? '暂停战术' : '播放战术', 'play-button')}${btn('reset', 'reset', '重置动画', 'icon-button')}<input type="range" id="timeline" aria-label="动画时间" min="0" max="${animationLength(p)}" step="0.01" value="${time}"><span id="time-label">${time.toFixed(1)} <span>/ ${animationLength(p).toFixed(1)}s</span></span></div></div>
      </section>${boardWidthHandle}<aside class="inspector" aria-label="战术属性">${inspector()}</aside></div>
      <footer class="app-footer"><span>PLAYBOOK STUDIO</span><span>画清路线，读懂比赛。</span><button data-action="help">快捷键与使用说明 ${icon('chevron')}</button></footer>
    </main></div>`;
  bindField(); syncEditorChrome(); protectReadOnly(); protectReference(); boardLayout.mount(); maddenLibrary.refresh();
  for (const [selector,top] of scrolls) if($(selector))$(selector).scrollTop=top;
  if (previousPlay && previousPlay!==p.id) revealPlay($('#field svg'));
  else if(previousPlay) enterPlayers($('#field'),new Set(p.players.filter(v=>!existingIds.has(v.id)).map(v=>v.id)));
  if(!previousPlay) enterWorkbench(document.querySelector('.workspace'));
  renderedPlayId=p.id;
}
function fieldContext() {
  if(rehearsal) return `<span class="context-status"><i class="live-dot"></i>${playing?'演练播放中':time>=animationLength(current())?'演练完成':time?'演练已暂停':'演练就绪'}</span><button class="context-primary" data-action="play" aria-label="${playing?'暂停演练':'开始演练'}">${icon(playing?'pause':'play')}${playing?'暂停':time>=animationLength(current())?'重播':'播放'}</button><button data-action="reset" aria-label="重新开始演练">${icon('reset')}</button><button data-action="edit-mode">返回布阵</button>`;
  if(draft) {
    const owner=current().players.find(p=>p.id===draft.playerId);
    return `<span class="context-player">${e(owner?.label)}<small>${draft.points.length-1} 个路线点</small></span><button data-action="undo-point" ${draft.points.length<2?'disabled':''}>${icon('undo')}退一步</button><button class="context-primary" data-action="finish-route" ${draft.points.length<2?'disabled':''}>${icon('check')}完成</button><button data-action="cancel-draft" aria-label="取消路线">${icon('close')}</button>`;
  }
  if(selection?.type==='player' && canEdit())return `<span class="context-player">${e(selectedObject()?.label)}<small>已选中</small></span><button class="context-primary" data-action="tool:route">${icon('route')}画路线</button><button data-action="delete-selection" aria-label="删除选中的球员">${icon('trash')}</button><button data-action="clear-selection" aria-label="取消选择">${icon('close')}</button>`;
  if(selection?.type==='route' && canEdit())return `<span>拖动节点调整路线</span><button data-action="delete-selection">${icon('trash')}删除</button><button data-action="clear-selection" aria-label="取消选择">${icon('close')}</button>`;
  return '';
}
function canvasHint() {
  if (current().reference) return '<span><i class="hint-dot"></i>Huddle.gg 原始战术图 · 原图路线不可拖动或播放；可在右侧记录教练笔记。</span>';
  const drawing = drawingTools.includes(tool), active = draft ? (draft.points.length > 1 ? 3 : 2) : selection?.type === 'player' ? 2 : 1;
  const hasMain=draft && ['route','motion'].includes(tool) && current().routes.some(r=>r.playerId===draft.playerId&&!r.optional&&['route','motion'].includes(r.kind));
  return `<span><i class="hint-dot"></i>${canEdit() ? hint() : '只读模式 · 点击球员或路线查看属性，按播放查看战术演练'}</span><span class="shortcut-hint">${draft?'点击落点 · Backspace 退一步 · Enter 完成':selection?'Esc 取消选择 · Delete 删除 · 可撤销':'V 选择 · R 路线 · Space 播放'}</span>${hasMain?`<label class="draft-behavior">该球员已有主路线<select id="draft-mode" aria-label="新路线用途"><option value="main" ${draft.mode!=='optional'?'selected':''}>新路线作为主路线，旧路线保留为选项</option><option value="optional" ${draft.mode==='optional'?'selected':''}>添加为选项，演练继续使用原主路线</option></select></label>`:''}${drawing && canEdit() ? `<div class="drawing-steps">${['选择一名球员','点击路线终点 / 转折点','完成并保存'].map((v,i)=>`<span class="${active === i+1 ? 'current' : ''}"><b>${i+1}</b>${v}</span>`).join('')}</div>` : ''}`;
}
function updateCanvasHint() {
  const n=$('.canvas-hint');if(n)n.innerHTML=canvasHint();
  const context=$('#field-context'), html=fieldContext();
  if(context && context.innerHTML!==html) {context.innerHTML=html; if(html)enterContext(context);}
}
function playbackPhase() {
  return time===0?'准备开球':time>=animationLength(current())?'演练完成':current().ball.receiverId && time>=current().ball.passAt && time<current().ball.arriveAt?'传球中':time>=current().ball.arriveAt && current().ball.receiverId?'接球后跑动':'路线展开';
}
function syncPlayback() {
  const timeline=$('#timeline');if(!timeline)return;
  timeline.value=time; timeline.style.setProperty('--progress',`${time/animationLength(current())*100}%`);
  const stamp=`${time.toFixed(1)} <span>/ ${animationLength(current()).toFixed(1)}s</span>`;
  if($('#time-label').innerHTML!==stamp)$('#time-label').innerHTML=stamp;
  if($('#playback-phase').textContent!==playbackPhase())$('#playback-phase').textContent=playbackPhase();
  for(const button of document.querySelectorAll('[data-action="play"]')){
    const contextual=!!button.closest('.field-context'),label=contextual?(playing?'暂停演练':'开始演练'):(playing?'暂停战术':'播放战术');
    if(button.getAttribute('aria-label')!==label){button.innerHTML=icon(playing?'pause':'play')+(contextual?(playing?'暂停':'播放'):'');button.setAttribute('aria-label',label);button.title=label;}
  }
  $('.playback').classList.toggle('is-playing',playing);
  $('#field').classList.toggle('is-running',playing);
}
function syncEditorChrome() {
  const field=$('#field');if(!field)return;
  field.className=`field-wrap tool-${tool} ${rehearsal?'is-rehearsal':''} ${playing?'is-running':''}`;
  for(const button of document.querySelectorAll('[data-action^="tool:"]')) {const active=button.dataset.action===`tool:${tool}`;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}
  $('.draw-tools')?.style.setProperty('--tool-index',['select','route','block','motion','pass','zone','text'].indexOf(tool));
  $('.toolbar')?.classList.toggle('rehearsal-toolbar',rehearsal);
  for(const action of ['edit-mode','rehearse-mode']) {const button=$(`[data-action="${action}"]`);if(button){const active=action==='rehearse-mode'?rehearsal:!rehearsal;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}}
  const sidebar=$('.sidebar');if(sidebar)sidebar.inert=!!window.matchMedia?.('(max-width: 720px)').matches&&!sidebarOpen;
  updateCanvasHint();syncPlayback();
}
function setTool(next) {
  if (current().reference) { if (next !== 'select') toast('这是原始战术图，可记录笔记；没有可编辑的路线坐标。', { type: 'warning' }); return; }
  if(next===tool && draft)return;
  if(next!==tool && !confirmDraft(()=>setTool(next)))return;
  resetAnimation(); rehearsal=false; tool=next; draft=null;previewPoint=null;
  if(drawingTools.includes(next)) {
    const player=selection?.type==='player'?selectedObject():current().players.find(p=>p.id===selectedObject()?.playerId);
    if(player) {selection={type:'player',id:player.id};draft={playerId:player.id,points:[{x:player.x,y:player.y}]};}
  }
  renderField();syncEditorChrome();protectReadOnly();
}
function confirmDraft(next) {
  if (!draft) return true;
  pendingNavigation = next;
  openModal('这条路线还没有完成', '<p>切换会放弃正在绘制的路线点。你可以继续绘制，或放弃这条草稿后切换。</p><p class="muted small">已经完成并保存的路线不受影响。</p>', '<button class="button subtle" data-action="keep-drawing">继续绘制</button><button class="button danger" data-action="discard-draft">放弃草稿并继续</button>');
  return false;
}
function hint() {
  if (rehearsal || playing || time > 0) return '按空格播放 / 暂停；拖动进度条检查跑位，返回布阵继续编辑';
  if (draft) return '移动鼠标预览下一段，点击落点；完成按钮或 Enter 保存';
  return { select: '拖动球员调整阵型；点击路线编辑节点', route: '先点球员，再点击球场画路线；Enter 完成', block: '先点球员，再点击阻挡终点；Enter 完成', motion: '先点球员，画开球前移动的锯齿线', pass: '先点持球球员，画虚线传球路径', zone: '在球场上拖动，画出防守覆盖区域', text: '点击球场，放置一条文字标注' }[tool];
}
const fieldInput = (label, key, value, type = 'text', attrs = '') => `<label class="form-field"><span>${label}</span><input data-prop="${key}" type="${type}" value="${e(value)}" ${attrs}></label>`;
const option = (value, label, selected) => `<option value="${e(value)}" ${value === selected ? 'selected' : ''}>${e(label)}</option>`;
function inspector() {
  const p = current(), obj = selectedObject();
  let content;
  if (p.reference) return `<div class="madden-source-box"><strong>${e(p.reference.game)} · ${p.reference.team === 'eagles' ? 'Eagles' : 'Ravens'}</strong><p>${e(p.formation)}</p><p>原始战术图保留原版路线与水印。图片不含球员坐标，不支持路线动画。</p><a href="${e(p.reference.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看 Huddle.gg 原页面 ↗</a></div>${fieldInput('战术名称', 'title', p.title, 'text', 'maxlength="120"')}${fieldInput('分类', 'category', p.category, 'text', 'maxlength="60"')}<div class="inspector-heading"><span>教练笔记</span></div><textarea data-prop="notes" rows="8" aria-label="教练笔记" placeholder="使用场景、阅读顺序、调整方案…" maxlength="10000">${e(p.notes)}</textarea><button class="button danger quiet full" data-action="delete-play">${icon('trash')}删除此战术</button><div class="inspector-note">${icon('check')}${cloudMode() ? '沿用当前共享战术本的保存与成员权限' : '自动保存在此浏览器'}</div>`;
  if (selection?.type === 'player' && obj) {
    const assigned = state.data.roster.find(r => r.name === obj.name)?.id || '';
    content = `<div class="inspector-heading"><span>球员设置</span><span class="tag">${obj.side === 'offense' ? '进攻' : '防守'}</span></div><div class="player-preview"><span style="background:${obj.color}">${e(obj.label)}</span><div><strong>${e(obj.name || '未分配球员')}</strong><small>拖动球场上的标记调整站位</small></div></div>${fieldInput('位置标签', 'label', obj.label, 'text', 'maxlength="10"')}<label class="form-field"><span>分配球队球员</span><select data-prop="roster"><option value="">不指定球员</option>${state.data.roster.map(r => option(r.id, `#${r.number} ${r.name} · ${r.position}`, assigned)).join('')}</select></label>${fieldInput('显示姓名', 'name', obj.name, 'text', 'maxlength="80"')}<div class="form-row">${fieldInput('标记颜色', 'color', obj.color, 'color')}<label class="form-field"><span>图形</span><select data-prop="shape">${[['circle', '圆形'], ['square', '方形'], ['triangle', '三角形']].map(([v, l]) => option(v, l, obj.shape)).join('')}</select></label></div><div class="inspector-divider"></div><div class="inspector-heading"><span>画一条路线</span></div><div class="route-quick">${[['route', '跑动'], ['block', '阻挡'], ['motion', '移动'], ['pass', '传球']].map(([v, l]) => `<button data-action="tool:${v}" class="${tool === v ? 'active' : ''}">${icon(v)}${l}</button>`).join('')}</div><div class="route-list">${p.routes.filter(r => r.playerId === obj.id).map(r => `<button data-action="select-route:${e(r.id)}">${icon(r.kind)}<span>${r.optional ? '选项' : ''}${({ route: '跑动路线', block: '阻挡路线', motion: '移动路线', pass: '传球路线' })[r.kind]}</span>${icon('chevron')}</button>`).join('')}</div><button class="button danger full" data-action="delete-selection">${icon('trash')}移除球员</button>`;
  } else if (selection?.type === 'route' && obj) {
    const owner = p.players.find(v => v.id === obj.playerId);
    content = `<div class="inspector-heading"><span>路线设置</span><span class="tag">${e(owner?.label)}</span></div><p class="muted small">拖动球场上的实心节点来调整路线。</p><label class="form-field"><span>线型</span><select data-prop="kind">${[['route', '跑动实线'], ['block', '阻挡路线'], ['motion', '移动锯齿线'], ['pass', '传球虚线']].map(([v, l]) => option(v, l, obj.kind)).join('')}</select></label><div class="form-row">${fieldInput('路线颜色', 'color', obj.color, 'color')}<label class="form-field"><span>末端样式</span><select data-prop="endCap">${[['arrow', '箭头'], ['bar', '阻挡横杠'], ['dot', '圆点']].map(([v, l]) => option(v, l, obj.endCap)).join('')}</select></label></div><label class="check-label"><input data-prop="smooth" type="checkbox" ${obj.smooth ? 'checked' : ''}>平滑曲线</label><label class="check-label"><input data-prop="optional" type="checkbox" ${obj.optional ? 'checked' : ''}>选项路线（不参与主线动画）</label><div class="inspector-divider"></div><div class="inspector-heading"><span>动画时序</span><small>秒</small></div><div class="form-row">${fieldInput('启动延迟', 'delay', obj.delay, 'number', 'min="0" max="10" step="0.1"')}${fieldInput('跑动时长', 'duration', obj.duration, 'number', 'min="0.2" max="10" step="0.1"')}</div><p class="muted small">球员按路线长度匀速运动。阻挡与传球线保留为图示。</p><button class="button danger full" data-action="delete-selection">${icon('trash')}删除路线</button>`;
  } else if (selection?.type === 'zone' && obj) {
    content = `<div class="inspector-heading"><span>防守区域</span></div>${fieldInput('区域名称', 'label', obj.label, 'text', 'maxlength="80"')}${fieldInput('区域颜色', 'color', obj.color, 'color')}<div class="form-row">${fieldInput('横向半径', 'rx', obj.rx, 'number', 'min="1" max="50" step="1"')}${fieldInput('纵向半径', 'ry', obj.ry, 'number', 'min="1" max="50" step="1"')}</div><p class="muted small">拖动区域中心移动覆盖范围。</p><button class="button danger full" data-action="delete-selection">${icon('trash')}删除区域</button>`;
  } else if (selection?.type === 'annotation' && obj) {
    content = `<div class="inspector-heading"><span>文字标注</span></div>${fieldInput('标注内容', 'text', obj.text, 'text', 'maxlength="200"')}<p class="muted small">拖动文字移动标注位置。</p><button class="button danger full" data-action="delete-selection">${icon('trash')}删除标注</button>`;
  } else {
    content = `<div class="inspector-heading"><span>战术详情</span><span class="tag">${BOOKS[p.book]}</span></div>${fieldInput('战术名称', 'title', p.title, 'text', 'maxlength="120"')}${fieldInput('分类', 'category', p.category, 'text', 'maxlength="60"')}<label class="form-field"><span>阵型模板</span><select id="apply-formation"><option value="">${e(p.formation)}</option>${FORMATIONS.map(f => `<option value="builtin:${e(f)}">${e(f)}</option>`).join('')}${state.data.formations.filter(f => f.book === p.book).map(f => `<option value="custom:${e(f.id)}">${e(f.name)} · 自定义</option>`).join('')}</select></label>${fieldInput('人员组', 'personnel', p.personnel, 'text', 'maxlength="80"')}<div class="formation-actions"><button data-action="save-formation">${icon('save')} 保存当前阵型</button><button data-action="opponents">${icon('team')} ${p.players.some(v => v.side === (p.book === 'defense' ? 'offense' : 'defense')) ? '移除' : '添加'}对方阵型</button></div><div class="inspector-divider"></div><div class="inspector-heading"><span>教练笔记</span></div><textarea data-prop="notes" rows="5" aria-label="教练笔记" placeholder="阅读顺序、跑位要点、调整方案…" maxlength="10000">${e(p.notes)}</textarea><div class="inspector-divider"></div><div class="inspector-heading"><span>足球移动</span>${icon('ball')}</div><label class="form-field"><span>持球人</span><select data-ball="holderId">${p.players.map(v => option(v.id, `${v.label}${v.name ? ' · ' + v.name : ''}`, p.ball.holderId)).join('')}</select></label><label class="form-field"><span>传给</span><select data-ball="receiverId"><option value="">不传球 / 跑球</option>${p.players.filter(v => v.id !== p.ball.holderId).map(v => option(v.id, `${v.label}${v.name ? ' · ' + v.name : ''}`, p.ball.receiverId)).join('')}</select></label><div class="form-row">${fieldInput('出手时间', 'ball.passAt', p.ball.passAt, 'number', 'min="0" max="10" step="0.1"')}${fieldInput('到达时间', 'ball.arriveAt', p.ball.arriveAt, 'number', 'min="0.1" max="15" step="0.1"')}</div><div class="inspector-divider"></div><div class="inspector-heading"><span>添加对象</span></div><div class="route-quick"><button data-action="add-player:offense">${icon('plus')}进攻球员</button><button data-action="add-player:defense">${icon('plus')}防守球员</button></div><button class="button subtle full" data-action="add-defense-43" title="4 名锋线 · 3 名线卫 · 4 名后卫">${icon('team')}${p.players.some(v => v.side === 'defense') ? '重设' : '添加'} 4–3 防守阵型（11 人）</button><label class="check-label"><input id="show-names" type="checkbox" ${viewSettings().showNames ? 'checked' : ''}>显示球员姓名</label><button class="button danger quiet full" data-action="delete-play">${icon('trash')}删除此战术</button>`;
  }
  return `${content}${selection ? '<button class="back-details" data-action="clear-selection">← 返回战术详情</button>' : ''}<div class="inspector-note">${icon('check')}${cloudMode() ? (canEdit() ? '所有修改自动同步到共享战术本' : '当前拥有只读权限') : '所有修改自动保存在此浏览器'}</div>`;
}
function renderField() {
  const field=$('#field');if(!field)return;
  const template=document.createElement('template');template.innerHTML=fieldSVG(current(),viewSettings(),{selected:selection,time,drawing:draft});
  field.querySelector('.pitch-svg').replaceWith(template.content.firstElementChild);
  const tag=field.querySelector('.field-tag');if(tag)tag.innerHTML=`${icon('ball')}<span>${current().players.filter(p=>p.side==='offense').length} O / ${current().players.filter(p=>p.side==='defense').length} D</span>`;
}
function refreshSelection() {
  const inspectorNode=$('.inspector'), context=inspectorNode.dataset.context, next=`${selection?.type||'play'}:${selection?.id||current().id}`;
  inspectorNode.innerHTML=inspector();inspectorNode.dataset.context=next;
  if(context!==next)enterContext(inspectorNode);
  renderField();updateCanvasHint();protectReadOnly();
}
function refreshMetadata() {
  const play=current(), heading=$('.play-header h1');
  heading.firstChild.textContent=`${play.title} `;document.title=`${play.title} · Playbook Studio`;
  for(const card of document.querySelectorAll('.play-card'))if(card.dataset.action===`choose:${play.id}`){
    card.querySelector('strong').textContent=play.title;card.querySelector('small').textContent=`${play.formation} · ${play.category}`;
    card.setAttribute('aria-label',`打开 ${play.title}`);
  }
  $('.eyebrow').innerHTML=`${e(play.personnel)} <span>·</span> ${e(play.category)}`;
  $('[data-action="undo"]').disabled=!history.past.length;$('[data-action="redo"]').disabled=!history.future.length;
  renderField();syncEditorChrome();protectReadOnly();
}
function coordinates(event) { const svg = $('#field svg'), box = svg.getBoundingClientRect(); return { x: clamp(((event.clientX - box.left) / box.width * 1000 - 18) / 9.64), y: clamp(((event.clientY - box.top) / box.height * 800 - 20) / 7.6) }; }
function pick(event) {
  const node = event.target.closest('[data-player],[data-route],[data-zone],[data-annotation]');
  if (!node) return null;
  for (const type of ['player', 'route', 'zone', 'annotation']) if (node.dataset[type]) return { type, id: node.dataset[type] };
  return null;
}
function bindField() {
  const field = $('#field');
  field.addEventListener('pointerdown', event => {
    if(event.target.closest('.field-context'))return;
    if (event.button !== 0) return;
    if (rehearsal || playing || time) { toast('当前在战术演练，点击「返回布阵」后可调整球员。', { type: 'info' }); return; }
    const at = coordinates(event), hit = pick(event);
    if (!canEdit()) { selection = hit; refreshSelection(); return; }
    if (tool === 'text') { textModal(at); return; }
    if (drawingTools.includes(tool)) {
      if (hit?.type === 'player' && (!draft || draft.playerId !== hit.id)) {
        const begin=()=>{selection=hit;const p=selectedObject();draft={playerId:p.id,points:[{x:p.x,y:p.y}]};previewPoint=null;refreshSelection();};
        if(draft?.points.length>1){confirmDraft(()=>{draft=null;begin();});return;}
        begin();return;
      }
      if (!draft) {
        const p = selection?.type === 'player' ? selectedObject() : current().players.find(v => v.id === selectedObject()?.playerId);
        if (!p) { toast('先点击一个球员，再开始画路线。', { type: 'warning' }); return; }
        draft = { playerId: p.id, points: [{ x: p.x, y: p.y }] };
      }
      if (draft.points.length < 200 && (!draft.points.at(-1) || Math.hypot(at.x - draft.points.at(-1).x, at.y - draft.points.at(-1).y) > .3)) draft.points.push(at);
      previewPoint=null;renderField(); updateCanvasHint(); return;
    }
    event.preventDefault(); field.setPointerCapture?.(event.pointerId);
    if (tool === 'zone') { drag = { type: 'new-zone', start: at, before: clone(state), zoneId: uid() }; return; }
    const point = event.target.closest('[data-point]');
    if (point) { drag = { type: 'point', routeId: point.dataset.routeId, index: Number(point.dataset.point), start: at, before: clone(state) }; return; }
    selection = hit;
    if (hit) { drag = { ...hit, start: at, before: clone(state), original: clone(selectedObject()), moved: false }; }
    refreshSelection();
  });
  field.addEventListener('pointermove', event => {
    if(draft && !drag) {previewPoint=coordinates(event); if(!gestureFrame)gestureFrame=requestAnimationFrame(()=>{gestureFrame=null;previewDraft(field.querySelector('svg'),draft,previewPoint);});return;}
    if (!drag || !canEdit()) return;
    pendingPoint=coordinates(event);
    if(!gestureFrame)gestureFrame=requestAnimationFrame(flushGesture);
  });
  function flushGesture() {
    if(gestureFrame)cancelAnimationFrame(gestureFrame);gestureFrame=null;
    if(!drag || !pendingPoint)return;
    const at=pendingPoint,p=current();pendingPoint=null;
    if(Math.hypot(at.x-drag.start.x,at.y-drag.start.y)<.2 && !drag.moved)return;
    drag.moved=true;field.classList.add('is-dragging');
    if(drag.type==='player') {
      const initial=drag.before.data.plays.find(p=>p.id===state.selectedId), original=drag.original;
      const player=p.players.find(v=>v.id===drag.id);player.x=original.x;player.y=original.y;
      for(const route of p.routes)if(route.playerId===drag.id)route.points=clone(initial.routes.find(r=>r.id===route.id).points);
      movePlayer(p,drag.id,original.x+at.x-drag.start.x,original.y+at.y-drag.start.y);
    } else if(drag.type==='point') p.routes.find(r=>r.id===drag.routeId).points[drag.index]=at;
    else if(drag.type==='new-zone') {
      let zone=p.zones.find(v=>v.id===drag.zoneId);
      if(!zone){zone={id:drag.zoneId,x:50,y:40,rx:1,ry:1,color:COLORS.zone,label:'ZONE'};p.zones.push(zone);selection={type:'zone',id:zone.id};renderField();}
      Object.assign(zone,{x:(drag.start.x+at.x)/2,y:(drag.start.y+at.y)/2,rx:Math.max(1,Math.abs(at.x-drag.start.x)/2),ry:Math.max(1,Math.abs(at.y-drag.start.y)/2)});
    } else if(['zone','annotation'].includes(drag.type)) {const obj=selectedObject();obj.x=clamp(drag.original.x+at.x-drag.start.x);obj.y=clamp(drag.original.y+at.y-drag.start.y);}
    updateGeometry(field.querySelector('svg'),p);
    const readout=field.querySelector('.drag-readout');readout.hidden=false;readout.textContent=`${drag.original?.label||'调整位置'} · X ${at.x.toFixed(1)} / Y ${at.y.toFixed(1)}`;
  }
  const endDrag = event => {
    if (!drag) return;
    // Flush the last pointer sample even if release happens before the next frame.
    flushGesture(); const before=drag.before,moved=drag.moved;
    if(field.hasPointerCapture?.(event.pointerId))field.releasePointerCapture(event.pointerId);
    drag=null;field.classList.remove('is-dragging');field.querySelector('.drag-readout').hidden=true;
    if(moved){history.record(before);save();render();}
  };
  field.addEventListener('pointerup',endDrag);
  field.addEventListener('pointercancel',()=>{if(gestureFrame)cancelAnimationFrame(gestureFrame);gestureFrame=null;pendingPoint=null;if(drag){state=drag.before;drag=null;render();}});
  field.addEventListener('pointerleave',()=>{if(!drag)previewDraft(field.querySelector('svg'),draft,null);});
  field.addEventListener('dblclick', event => { if (draft) { event.preventDefault(); finishRoute(); } });
  field.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.dataset.player && !event.target.dataset.route && !event.target.dataset.zone) return;
    event.preventDefault(); event.stopPropagation(); selection = pick(event); refreshSelection();
  });
}
function finishRoute() {
  if (!draft || draft.points.length < 2) { toast('至少点击一个路线终点。', { type: 'warning' }); return; }
  if (current().routes.length >= 100) { toast('每个战术最多 100 条路线。', { type: 'warning' }); return; }
  const alreadyMoving = current().routes.some(r => r.playerId === draft.playerId && !r.optional && ['route', 'motion'].includes(r.kind));
  const route = { id: uid(), playerId: draft.playerId, points: clone(draft.points), kind: tool, color: tool === 'pass' ? COLORS.pass : current().players.find(p => p.id === draft.playerId).color, smooth: false, endCap: tool === 'block' ? 'bar' : 'arrow', delay: 0, duration: tool === 'block' ? 2 : 4, optional: alreadyMoving && draft.mode==='optional' && ['route', 'motion'].includes(tool) };
  selection={type:'route',id:route.id};tool='select';
  edit(p=>{if(!route.optional&&['route','motion'].includes(route.kind))p.routes.filter(r=>r.playerId===route.playerId&&!r.optional&&['route','motion'].includes(r.kind)).forEach(r=>{r.optional=true;});p.routes.push(route);});
  burstAt(document.querySelector('#field-context'));
  toast(alreadyMoving&&!route.optional?'新路线已设为主路线，旧路线保留为选项。可撤销恢复。':route.optional?'选项路线已保存，演练继续使用原主路线。':'路线已保存，可拖动节点调整。可撤销恢复。');
}

function openModal(title, body, footer = '', wide = false) {
  const previous = document.activeElement;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${e(title)}"><header><h2>${e(title)}</h2>${btn('close-modal', 'close', '关闭', 'icon-button')}</header><div class="modal-body">${body}${feedbackBox()}</div>${footer ? `<footer>${footer}</footer>` : ''}</section></div>`;
  $('#modal-root')._previous = previous;
  $('#app').inert = true; document.body.classList.add('modal-open');
  ($('#modal-root').querySelector('.modal-body input:not([readonly]),.modal-body select,.modal-body textarea') || $('#modal-root').querySelector('footer .primary,header button'))?.focus();
}
function closeModal() { $('#app').inert = false; document.body.classList.remove('modal-open'); $('#modal-root').innerHTML = ''; $('#print-root').innerHTML = ''; $('#modal-root')._previous?.focus?.(); }
function newModal() {
  openModal('新建战术', `<p class="muted">选一个阵型，把你的想法画在球场上。</p><label class="form-field"><span>战术名称</span><input id="new-title" value="新战术" maxlength="120"></label><div class="form-row"><label class="form-field"><span>战术本</span><select id="new-book">${Object.entries(BOOKS).map(([v, l]) => option(v, l, book)).join('')}</select></label><label class="form-field"><span>人数 / 每方</span><select id="new-count">${[6, 7, 8, 9, 11, 12].map(v => option(String(v), `${v} 人`, String(state.data.settings.league))).join('')}</select></label></div><label class="form-field"><span>阵型</span><select id="new-formation">${FORMATIONS.map(v => option(v, v, book === 'defense' ? '4–3' : book === 'special' ? 'Field Goal' : 'Gun Trips')).join('')}${state.data.formations.map(f => option(`custom:${f.id}`, `${f.name} · 自定义`, '')).join('')}</select></label>`, '<button class="button subtle" data-action="close-modal">取消</button><button class="button primary" data-action="create-play">创建战术</button>');
}
function textModal(at) { openModal('添加场上标注', '<label class="form-field"><span>标注内容</span><input id="annotation-text" placeholder="例如：Read 1 · 先读浅交叉" maxlength="200"></label>', `<button class="button primary" data-action="create-text" data-x="${at.x}" data-y="${at.y}">放置标注</button>`); }
function exportModal() {
  openModal('导出与备份', `<div class="export-grid"><button data-action="download-svg">${icon('route')}<strong>${current().reference ? '原图战术文件' : '矢量战术图'}</strong><small>${current().reference ? 'SVG · 内嵌原始图片' : 'SVG · 任意放大，适合课件'}</small></button><button data-action="download-png">${icon('export')}<strong>高清图片</strong><small>PNG · ${current().reference ? '2000 × 1120 · 原图分辨率' : '2000 × 1600'}</small></button><button data-action="download-json">${icon('book')}<strong>完整战术本</strong><small>JSON · ${state.data.plays.length} 个战术 + 阵型与名单</small></button><button data-action="download-play">${icon('copy')}<strong>当前战术</strong><small>JSON · 可导入继续编辑</small></button></div><p class="muted small">${cloudMode() ? '团队成员会自动读取云端的同一份战术。JSON 用于额外备份或迁移，图片用于分享与课件。' : '本地预览仅保存到当前浏览器。请用 JSON 迁移到云端，图片用于分享与课件。'}</p>`);
}
function teamModal() {
  openModal('球队与球员名单', `<div class="form-row"><label class="form-field"><span>球队名称</span><input id="team-name" value="${e(state.data.team.name)}" maxlength="80"></label><label class="form-field"><span>赛季 / 副标题</span><input id="team-subtitle" value="${e(state.data.team.subtitle)}" maxlength="80"></label></div><div class="form-row"><label class="form-field"><span>球队颜色</span><input id="team-accent" type="color" value="${state.data.team.accent}"></label><label class="form-field"><span>默认人数</span><select id="team-league">${[6, 7, 8, 9, 11, 12].map(v => option(String(v), `${v} 人制`, String(state.data.settings.league))).join('')}</select></label></div><div class="inspector-divider"></div><div class="inspector-heading"><span>名单</span><small>选中球场球员后可分配</small></div><div class="roster-labels"><span>号码</span><span>姓名</span><span>位置</span><span></span></div><div id="roster-rows">${state.data.roster.map(rosterRow).join('')}</div><button class="text-button" data-action="roster-add">+ 添加球员</button>`, '<button class="button subtle" data-action="close-modal">取消</button><button class="button primary" data-action="save-team">保存球队</button>', true);
}
function rosterRow(r) { return `<div class="roster-row" data-roster-id="${e(r.id)}"><input data-roster-field="number" aria-label="球衣号码" value="${e(r.number)}" maxlength="5"><input data-roster-field="name" aria-label="球员姓名" value="${e(r.name)}" maxlength="80"><input data-roster-field="position" aria-label="球员位置" value="${e(r.position)}" maxlength="15">${btn('roster-remove', 'close', '移除此行', 'small-icon')}</div>`; }
function helpModal() {
  openModal('让战术动起来', `<div class="help-intro"><img src="./assets/stingers-mark.png" width="48" height="48" alt=""><div><strong>Playbook Studio</strong><p>从阵型到跑位，一张图说清楚。</p></div></div><ol class="help-steps"><li><b>选阵型</b>在右侧应用模板，或拖动球员排出自己的阵型。</li><li><b>画路线</b>点选球员 → 点击浮动工具条的「画路线」 → 移动鼠标预览，点击转折点 → 完成保存。绘制时可退一步。</li><li><b>调时序</b>点选路线，设置启动延迟与时长。可设置足球的出手和到达时间。</li><li><b>播放与分享</b>空格播放，拖动时间轴逐帧检查。导出 JSON 或打印战术本与腕带。</li></ol><div class="keyboard-grid">${[['V', '选择移动'], ['R', '跑动路线'], ['B', '阻挡'], ['M', '开球前移动'], ['P', '传球线'], ['Z', '覆盖区域'], ['T', '文字标注'], ['Space', '播放 / 暂停'], ['Enter', '完成路线'], ['Esc', '取消绘制 / 关闭'], ['Ctrl / ⌘ Z', '撤销'], ['Delete', '删除选中对象']].map(([k, l]) => `<span><kbd>${k}</kbd>${l}</span>`).join('')}</div><div class="help-about"><strong>关于数据和实现</strong><p>云端版按成员权限共享战术；导出 JSON 可备份和迁移。云端版支持共享保存、成员权限与版本记录；本地预览版使用浏览器存储。</p><p>这是参考 Playmaker X 公开功能独立实现的工具，非官方产品。动画用于战术教学，不模拟碰撞、对抗或完整比赛物理。</p><a href="https://github.com/TIMPICKLE/playbook-studio-web" target="_blank" rel="noopener">代码与公开功能调查 →</a></div>`, '<button class="button primary" data-action="close-modal">开始设计</button>', true);
}

function printModal() {
  openModal('打印战术本', `<div class="form-row"><label class="form-field"><span>内容范围</span><select id="print-scope"><option value="current">当前战术</option><option value="filtered">当前筛选（${filtered().length} 个）</option><option value="all">全部战术（${state.data.plays.length} 个）</option></select></label><label class="form-field"><span>打印版式</span><select id="print-layout"><option value="playbook">战术本 · 每页 2 个</option><option value="wristband">腕带卡 · 每页 9 个</option><option value="callsheet">Call Sheet · 战术清单</option></select></label></div><div id="print-preview" class="print-preview"></div><p class="muted small">建议 A4 纸，关闭浏览器页眉页脚；在打印窗口可选择「另存为 PDF」。</p>`, '<button class="button subtle" data-action="close-modal">关闭</button><button class="button primary" data-action="do-print">打开打印窗口</button>', true);
  updatePrint();
}
function updatePrint() {
  const scope = $('#print-scope').value, layout = $('#print-layout').value;
  const plays = scope === 'current' ? [current()] : scope === 'all' ? state.data.plays : filtered();
  const count = layout === 'wristband' ? 9 : layout === 'callsheet' ? 24 : 2;
  let html = '';
  for (let offset = 0; offset < plays.length; offset += count) {
    const group = plays.slice(offset, offset + count);
    const header = `<div class="print-heading"><strong>${e(state.data.team.name)}</strong><span>${layout === 'wristband' ? 'WRISTBAND' : layout === 'callsheet' ? 'CALL SHEET' : 'PLAYBOOK'} · ${e(state.data.team.subtitle)}</span></div>`;
    html += `<article class="print-page ${layout}">${header}${layout === 'callsheet' ? `<table><thead><tr><th>#</th><th>战术</th><th>阵型</th><th>分类</th><th>人员组</th></tr></thead><tbody>${group.map((p, i) => `<tr><td>${offset + i + 1}</td><td>${e(p.title)}</td><td>${e(p.formation)}</td><td>${e(p.category)}</td><td>${e(p.personnel)}</td></tr>`).join('')}</tbody></table>` : `<div class="print-cards">${group.map((p, i) => `<section class="print-card"><h3><b>${String(offset + i + 1).padStart(2, '0')}</b> ${e(p.title)}</h3>${fieldSVG(p, { ...state.data.settings, showNames: false }, { print: true, prefix: `print-${offset + i}` })}${layout === 'playbook' ? `<div class="print-meta">${e(p.formation)} · ${e(p.category)} · ${e(p.personnel)}</div><p class="print-notes">${e(p.notes)}</p>` : ''}</section>`).join('')}</div>`}<div class="print-foot">Playbook Studio <span>${Math.floor(offset / count) + 1}</span></div></article>`;
  }
  $('#print-root').innerHTML = html;
  $('#print-preview').innerHTML = html || '<p>当前筛选没有可打印的战术。</p>';
  if (html) $('#print-preview').querySelectorAll('[id]').forEach(n => n.id = `preview-${n.id}`);
  // Prefix SVG reference IDs in the preview to avoid duplicate marker bindings.
  $('#print-preview').innerHTML = $('#print-preview').innerHTML.replace(/url\(#print-/g, 'url(#preview-print-');
}
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const safeName = name => name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100) || 'play';
async function standaloneSVG(play) {
  let svg = fieldSVG(play, viewSettings(), { prefix: 'export' });
  if (play.reference) {
    const response = await fetch(new URL(`./${play.reference.image}`, import.meta.url));
    if (!response.ok) throw new Error('原始战术图加载失败，请重试。');
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    svg = svg.replace(`href="./${play.reference.image}"`, `href="${dataUrl}"`);
  }
  return svg;
}
async function pngExport() {
  const play = clone(current());
  let svg;
  try { svg = await standaloneSVG(play); } catch { toast('原始战术图加载失败，请重试。', { type: 'error', action: 'download-png', label: '重试' }); return; }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = play.reference ? 1120 : 1600; const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { if (blob) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = `${safeName(play.title)}.png`; document.body.append(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(u), 10000); toast('PNG 已生成。原始战术图保留来源分辨率。', { type: 'success' }); } else toast('PNG 生成失败，请尝试 SVG 导出。', { type: 'error' }); }, 'image/png');
    } catch { toast('此浏览器无法生成 PNG，请尝试 SVG 导出。', { type: 'error' }); }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('图片生成失败，请尝试 SVG 导出。', { type: 'error' }); }; img.src = url;
}
function togglePlay() {
  if (current().reference) { toast('原始战术图不包含可播放的路线数据。', { type: 'info' }); return; }
  if(draft && !confirmDraft(togglePlay))return;
  if(playing){stop();syncPlayback();updateCanvasHint();return;}
  if(time>=animationLength(current()))time=0;
  rehearsal=true;playing=true;draft=null;previewPoint=null;
  renderField();syncEditorChrome();
  const tick=stamp=>{
    if(!playing)return;
    if(lastFrame!==null)time+=Math.min((stamp-lastFrame)/1000,.1)*speed;
    lastFrame=stamp;
    if(time>=animationLength(current())) {
      if(loop)time%=animationLength(current());
      else{time=animationLength(current());stop();updateAnimation($('#field svg'),current(),time);syncPlayback();updateCanvasHint();return;}
    }
    updateAnimation($('#field svg'),current(),time);syncPlayback();
    frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
}

function deleteSelected() {
  if (!selection || !selectedObject()) return;
  const s = selection;
  if (s.type === 'player' && current().players.length <= 1) { toast('请保留至少一个球员。', { type: 'warning' }); return; }
  selection = null;
  edit(p => {
    const key = { player: 'players', route: 'routes', zone: 'zones', annotation: 'annotations' }[s.type]; p[key] = p[key].filter(x => x.id !== s.id);
    if (s.type === 'player') { p.routes = p.routes.filter(r => r.playerId !== s.id); if (p.ball.holderId === s.id) p.ball.holderId = p.players[0].id; if (p.ball.receiverId === s.id) p.ball.receiverId = ''; }
  }); toast('对象已删除，可撤销恢复。', { type: 'success' });
}
const actions = {
  'madden-library': () => { resetAnimation(); if (confirmDraft(() => maddenLibrary.open())) maddenLibrary.open(); },
  'clear-filters': () => { query=''; filter=''; formationFilter=''; render(); },
  'keep-drawing': () => { pendingNavigation=null; closeModal(); },
  'discard-draft': () => { draft=null; const next=pendingNavigation; pendingNavigation=null; closeModal(); next?.(); },
  new: newModal, 'close-modal': closeModal, export: exportModal, team: teamModal, help: helpModal, print: printModal,
  sidebar: () => { sidebarOpen=!sidebarOpen;$('.workspace').classList.toggle('sidebar-open',sidebarOpen);$('[data-action="sidebar"].mobile-menu')?.setAttribute('aria-expanded',sidebarOpen);syncEditorChrome(); },
  'dismiss-toast': () => $('#toast').classList.remove('visible'),
  'undo-point': () => {if(draft?.points.length>1){draft.points.pop();previewPoint=null;renderField();updateCanvasHint();}},
  'edit-mode': () => {if(!confirmDraft(()=>actions['edit-mode']()))return;resetAnimation();rehearsal=false;renderField();syncEditorChrome();},
  'rehearse-mode': () => {if(!confirmDraft(()=>actions['rehearse-mode']()))return;rehearsal=true;draft=null;renderField();syncEditorChrome();},
  favorite: () => edit(p => { p.favorite = !p.favorite; }),
  undo: () => restore(history.undo(state)), redo: () => restore(history.redo(state)),
  mirror: () => { const mirrored = mirrorPlay(current()); edit(p => Object.assign(p, mirrored)); toast('球员、路线、区域与标注已左右镜像。', { type: 'success' }); },
  duplicate: () => { if (state.data.plays.length >= 500) { toast('战术本最多 500 个战术。', { type: 'warning' }); return; } const copy = clone(current()); copy.id = uid(); copy.title = `${copy.title} · 副本`.slice(0, 120); copy.createdAt = new Date().toISOString(); selection = null; edit((p, d) => { d.plays.push(copy); state.selectedId = copy.id; }); },
  'clear-selection': () => {if(!confirmDraft(()=>actions['clear-selection']()))return; selection=null;draft=null;tool='select';refreshSelection();syncEditorChrome();},
  grid: () => { viewOverrides.showGrid = !viewSettings().showGrid; render(); },
  theme: () => { viewOverrides.fieldTheme = viewSettings().fieldTheme === 'dark' ? 'light' : 'dark'; render(); },
  'finish-route': finishRoute, 'cancel-draft': () => { draft=null;previewPoint=null;tool='select';renderField();syncEditorChrome(); },
  'delete-selection': deleteSelected,
  'create-play': () => {
    if (state.data.plays.length >= 500) { toast('战术本最多 500 个战术。', { type: 'warning' }); return; }
    const title = $('#new-title').value.trim(), b = $('#new-book').value, form = $('#new-formation').value, count = Number($('#new-count').value);
    if (!title) { feedback('请给战术起一个名字，再创建。'); $('#new-title').focus(); return; }
    const custom = form.startsWith('custom:') ? state.data.formations.find(f => f.id === form.slice(7)) : null;
    const p = makePlay({ title, formation: custom?.name || form, book: b, count });
    if (custom) { p.players = clone(custom.players); p.ball.holderId = p.players.find(v => v.label === 'QB')?.id || p.players[0].id; }
    closeModal(); selection = null; book = b; query = ''; filter = ''; formationFilter = ''; edit((_, d) => { d.plays.push(p); state.selectedId = p.id; d.settings.league = count; });
  },
  'create-text': node => { const value = $('#annotation-text').value.trim(); if (!value) { toast('请输入标注文字。', { type: 'warning' }); return; } const a = { id: uid(), text: value, x: Number(node.dataset.x), y: Number(node.dataset.y) }; closeModal(); selection = { type: 'annotation', id: a.id }; tool = 'select'; edit(p => p.annotations.push(a)); },
  'save-formation': () => openModal('保存自定义阵型', `<p class="muted small">只保存球员的初始站位、标签和颜色；路线仍保留在当前战术。</p><label class="form-field"><span>阵型名称</span><input id="formation-name" value="${e(current().formation)} · 自定义" maxlength="100"></label>`, '<button class="button primary" data-action="confirm-formation">保存阵型</button>'),
  'confirm-formation': () => { const name = $('#formation-name').value.trim(); if (!name) return; if (state.data.formations.length >= 100) { toast('最多保存 100 个自定义阵型。', { type: 'warning' }); return; } const f = { id: uid(), name, book: current().book, players: clone(current().players) }; closeModal(); edit((p, d) => { d.formations.push(f); p.formation = name; }); toast('自定义阵型已保存，可用于新战术。', { type: 'success' }); },
  'add-defense-43': confirmed => {
    if (current().players.filter(p => p.side !== 'defense').length + 11 > 40) { toast('添加完整防守后会超过 40 个球员标记，请先移除部分进攻球员。', { type: 'warning' }); return; }
    const defenders=new Set(current().players.filter(p=>p.side==='defense').map(p=>p.id)), routes=current().routes.filter(r=>defenders.has(r.playerId)).length;
    if(routes && confirmed!==true){
      actions['confirm-defense-43']=()=>{closeModal();actions['add-defense-43'](true);};
      openModal('重设 4–3 防守？',`<p>将防守队员重新布置为 4 名锋线、3 名线卫、4 名后卫，并清除他们现有的 <strong>${routes} 条路线</strong>。</p><p class="muted">进攻球员与进攻路线会保留。完成后可以撤销。</p>`,'<button class="button subtle" data-action="close-modal">保留当前防守</button><button class="button primary" data-action="confirm-defense-43">重设防守并清除路线</button>');return;
    }
    const hadDefense = current().players.some(p => p.side === 'defense');
    selection = null; tool = 'select';
    edit(p => {
      const oldDefense = new Set(p.players.filter(v => v.side === 'defense').map(v => v.id));
      p.players = [...p.players.filter(v => !oldDefense.has(v.id)), ...formationPlayers('4–3', 11, 'defense')];
      p.routes = p.routes.filter(r => !oldDefense.has(r.playerId));
      if (oldDefense.has(p.ball.holderId)) p.ball.holderId = p.players.find(v => v.label === 'QB' && v.side === 'offense')?.id || p.players[0].id;
      if (oldDefense.has(p.ball.receiverId)) p.ball.receiverId = '';
    });
    toast(`${hadDefense ? '已重设' : '已添加'} 4–3 防守：4 名锋线、3 名线卫、4 名后卫。可撤销恢复。`);
  },
  opponents: () => {
    const side = current().book === 'defense' ? 'offense' : 'defense', remove = current().players.some(v => v.side === side);
    if (remove && current().players.every(v => v.side === side)) { toast('当前阵型只有这一方球员，请保留至少一个球员。', { type: 'warning' }); return; }
    if (!remove && current().players.length + state.data.settings.league > 40) { toast('添加后会超过 40 个球员标记，请先移除部分球员。', { type: 'warning' }); return; }
    edit(p => { if (remove) { const ids = new Set(p.players.filter(v => v.side === side).map(v => v.id)); p.players = p.players.filter(v => !ids.has(v.id)); p.routes = p.routes.filter(r => !ids.has(r.playerId)); if (ids.has(p.ball.holderId)) p.ball.holderId = p.players[0].id; if (ids.has(p.ball.receiverId)) p.ball.receiverId = ''; } else p.players.push(...formationPlayers(side === 'offense' ? 'Gun Doubles' : '4–3', state.data.settings.league, side)); });
  },
  'delete-play': () => { if (state.data.plays.length === 1) { toast('请保留至少一个战术。', { type: 'warning' }); return; } openModal('删除此战术', `<p>删除「${e(current().title)}」？本次编辑会保留在撤销历史中。</p>`, '<button class="button subtle" data-action="close-modal">取消</button><button class="button danger" data-action="confirm-delete">删除战术</button>'); },
  'confirm-delete': () => { const id = current().id; closeModal(); selection = null; edit((p, d) => { d.plays = d.plays.filter(p => p.id !== id); state.selectedId = d.plays.find(p => p.book === book)?.id || d.plays[0].id; book = current().book; }); },
  'roster-add': () => { if ($('#roster-rows').children.length >= 200) { toast('名单最多 200 人。', { type: 'warning' }); return; } $('#roster-rows').insertAdjacentHTML('beforeend', rosterRow({ id: uid(), name: '', number: '', position: '' })); },
  'roster-remove': node => node.closest('.roster-row').remove(),
  'save-team': () => { const team = { name: $('#team-name').value.trim() || 'MY TEAM', subtitle: $('#team-subtitle').value, accent: $('#team-accent').value }; const league = Number($('#team-league').value); const roster = [...$('#roster-rows').children].map(row => ({ id: row.dataset.rosterId, ...Object.fromEntries([...row.querySelectorAll('input')].map(n => [n.dataset.rosterField, n.value.trim()])) })).filter(r => r.name); closeModal(); edit((p, d) => { d.team = team; d.roster = roster; d.settings.league = league; }); toast('球队与球员名单已保存。', { type: 'success' }); },
  import: () => $('#import-input').click(),
  'download-svg': async () => { const play = clone(current()); try { download(await standaloneSVG(play), `${safeName(play.title)}.svg`, 'image/svg+xml'); toast('SVG 战术图已生成。', { type: 'success' }); } catch { toast('原始战术图加载失败，请重试。', { type: 'error', action: 'download-svg', label: '重试' }); } },
  'download-png': pngExport,
  'download-json': () => { download(encodeWorkspace(state.data), `${safeName(state.data.team.name)}-playbook.json`, 'application/json'); toast('完整战术本已生成。', { type: 'success' }); },
  'download-play': () => { download(encodeWorkspace({ ...state.data, plays: [current()] }), `${safeName(current().title)}.json`, 'application/json'); toast('当前战术已生成。', { type: 'success' }); },
  'do-print': () => { if (!$('#print-root').children.length) { toast('没有可打印的战术。', { type: 'warning' }); return; } window.print(); },
  play: togglePlay, reset: () => {resetAnimation();updateAnimation($('#field svg'),current(),0);syncPlayback();updateCanvasHint();}, loop: node => {loop=!loop;node.classList.toggle('enabled',loop);node.setAttribute('aria-pressed',loop);}
};

document.addEventListener('click', event => {
  for(const menu of document.querySelectorAll('.add-object-menu[open],.account-menu[open]'))if(!menu.contains(event.target))menu.open=false;
  const node = event.target.closest('[data-action]'); if (!node || node.disabled) return;
  const [name, ...parts] = node.dataset.action.split(':'), value = parts.join(':');
  if (current().reference && ['mirror','rehearse-mode','add-player','add-defense-43','opponents','save-formation'].includes(name)) { toast('原始战术图不包含可编辑的球员坐标。', { type: 'info' }); return; }
  if(name==='dismiss-toast'){actions[name]();return;}
  if (!canEdit() && !readActions.has(name) && !(name === 'tool' && value === 'select')) { toast('当前为只读权限。', { type: 'warning' }); return; }
  if(node.closest('.add-object-menu'))node.closest('details').open=false;
  if (name === 'choose') return choose(value);
  if (['book','new','import','add-player','add-defense-43','opponents','mirror'].includes(name) && !confirmDraft(() => node.click())) return;
  if (name === 'book') { resetAnimation(); draft = null; selection = null; book = value; filter = ''; formationFilter = ''; query = ''; const p = filtered()[0]; if (p) state.selectedId = p.id; render(); return; }
  if (name === 'tool') { setTool(value); return; }
  if (name === 'select-route') { selection = { type: 'route', id: value }; tool = 'select'; draft = null; refreshSelection(); return; }
  if (name === 'add-player') { if (current().players.length >= 40) { toast('每个战术最多 40 个球员标记。', { type: 'warning' }); return; } const p = { id: uid(), label: value === 'offense' ? 'WR' : 'DB', x: 25, y: value === 'offense' ? 75 : 45, name: '', side: value, color: COLORS[value], shape: value === 'offense' ? 'circle' : 'square' }; selection = { type: 'player', id: p.id }; edit(play => play.players.push(p)); return; }
  actions[name]?.(node);
});
function refreshPlayList() {
  const p = current(), plays = filtered();
  $('.play-list').innerHTML = plays.length ? plays.map((v, i) => `<button data-action="choose:${e(v.id)}" class="play-card ${p.id === v.id ? 'active' : ''}" aria-label="打开 ${e(v.title)}" aria-pressed="${p.id === v.id}"><div class="play-thumb">${fieldSVG(v, { showGrid: false }, { thumbnail: true, prefix: `thumb-${i}` })}</div><span class="play-card-info"><strong>${e(v.title)}</strong><small>${e(v.formation)} · ${e(v.category)}</small></span>${v.favorite ? '<span class="favorite-dot">★</span>' : ''}</button>`).join('') : '<div class="empty-list">没有找到匹配战术。<br>试试其他关键词或清除筛选。<button class="text-button" data-action="clear-filters">清除全部筛选</button></div>';
  $('.play-list-label b').textContent = plays.length;
}
let composingSearch = false;
function searchInput(input) { query = input.value; refreshPlayList(); }
document.addEventListener('compositionstart', event => { if (event.target.id === 'search') composingSearch = true; });
document.addEventListener('compositionend', event => { if (event.target.id === 'search') { composingSearch = false; searchInput(event.target); } });
document.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'search' && !composingSearch && !event.isComposing) searchInput(input);
  if(input.id==='timeline'){stop();rehearsal=true;time=Number(input.value);updateAnimation($('#field svg'),current(),time);syncEditorChrome();}
});
document.addEventListener('change', event => {
  const input = event.target;
  if (!canEdit() && (input.dataset.prop || input.dataset.ball || input.id === 'apply-formation')) return;
  if (input.id === 'category-filter') { filter = input.value; render(); }
  else if (input.id === 'formation-filter') { formationFilter = input.value; render(); }
  else if(input.id==='draft-mode' && draft)draft.mode=input.value;
  else if (input.id === 'speed') speed = Number(input.value);
  else if (input.id === 'show-names') { viewOverrides.showNames = input.checked; render(); }
  else if (input.id === 'print-scope' || input.id === 'print-layout') updatePrint();
  else if (input.id === 'apply-formation' && input.value) {
    const [kind, ...rest] = input.value.split(':'), value = rest.join(':');
    const custom = kind === 'custom' ? state.data.formations.find(f => f.id === value) : null;
    const players = custom ? clone(custom.players) : formationPlayers(value, state.data.settings.league, current().book === 'defense' ? 'defense' : 'offense');
    const apply = () => { closeModal(); edit(p => { p.players = players; p.formation = custom?.name || value; p.routes = []; p.zones = []; p.annotations = []; p.ball.holderId = players.find(v => v.label === 'QB')?.id || players[0].id; p.ball.receiverId = ''; }); toast('已替换阵型。路线与标注已清空，可用撤销恢复。', { type: 'success' }); };
    if (current().routes.length || current().zones.length || current().annotations.length) {
      actions['confirm-apply-formation'] = () => { delete actions['confirm-apply-formation']; apply(); };
      input.value = '';
      openModal('替换初始阵型？', `<p>将当前战术替换为 <strong>${e(custom?.name || value)}</strong>。</p><p>这会清除当前的 ${current().routes.length} 条路线、${current().zones.length} 个区域和 ${current().annotations.length} 条标注。球队名单与其他战术保持原样，操作后可撤销。</p>`, '<button class="button subtle" data-action="close-modal">取消</button><button class="button primary" data-action="confirm-apply-formation">替换阵型并清空路线</button>');
    } else apply();
  } else if (input.dataset.ball) {
    edit(p => { p.ball[input.dataset.ball] = input.value; if (p.ball.holderId === p.ball.receiverId) p.ball.receiverId = ''; }, {redraw:false});
    const receiver=$('[data-ball="receiverId"]'); if(receiver)receiver.innerHTML=`<option value="">不传球 / 跑球</option>${current().players.filter(v=>v.id!==current().ball.holderId).map(v=>option(v.id,`${v.label}${v.name?' · '+v.name:''}`,current().ball.receiverId)).join('')}`;
  }
  else if (input.dataset.prop) {
    const key = input.dataset.prop;
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (input.type === 'number') { if (!Number.isFinite(value)) return; value = clamp(value, Number(input.min), Number(input.max)); }
    if (key.startsWith('ball.')) {
      const name = key.slice(5), ball = { ...current().ball, [name]: value };
      if (ball.arriveAt <= ball.passAt) { toast('到达时间必须晚于出手时间。', { type: 'info' }); input.value = current().ball[name]; return; }
      edit(p => { p.ball[name] = value; }, {redraw:false});
    } else {
      const selected = !!selection, s = selection;
      edit((p, d) => { const obj = selected ? p[{ player: 'players', route: 'routes', zone: 'zones', annotation: 'annotations' }[s.type]].find(v => v.id === s.id) : p; if (!obj) return; if (key === 'roster') obj.name = d.roster.find(r => r.id === value)?.name || ''; else { obj[key] = value; if (key === 'kind' && value === 'block') obj.endCap = 'bar'; if (s?.type === 'route' && ((key === 'optional' && value === false) || key === 'kind') && !obj.optional && ['route', 'motion'].includes(obj.kind)) p.routes.filter(r => r.id !== obj.id && r.playerId === obj.playerId && ['route', 'motion'].includes(r.kind)).forEach(r => { r.optional = true; }); } }, {redraw:false});
      if(key==='roster' && $('[data-prop="name"]'))$('[data-prop="name"]').value=selectedObject().name;
      if(key==='kind' && $('[data-prop="endCap"]'))$('[data-prop="endCap"]').value=selectedObject().endCap;
    }
  }
});
$('#import-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('请导入 5 MB 以内的文件');
    const imported = decodeWorkspace(await file.text());
    if (state.data.plays.length + imported.plays.length > 500) throw new Error('战术数量不能超过 500 个');
    openModal('导入战术本', `<p>已验证文件，包含 <strong>${imported.plays.length} 个战术</strong>、${imported.formations.length} 个自定义阵型及 ${imported.roster.length} 名球员。</p><p class="muted small">导入将追加战术、阵型和名单，保留当前球队设置与已有战术。</p>`, '<button class="button subtle" data-action="close-modal">取消</button><button class="button primary" data-action="confirm-import">追加导入</button>');
    actions['confirm-import'] = () => {
      if (state.data.formations.length + imported.formations.length > 100 || state.data.roster.length + imported.roster.length > 200) { toast('导入后阵型或名单数量超出上限。', { type: 'info' }); return; }
      const plays = imported.plays.map(p => ({ ...p, id: uid() })), forms = imported.formations.map(f => ({ ...f, id: uid() })), roster = imported.roster.map(r => ({ ...r, id: uid() }));
      closeModal(); selection = null; book = plays[0].book; query = ''; filter = ''; formationFilter = ''; edit((p, d) => { d.plays.push(...plays); d.formations.push(...forms); d.roster.push(...roster); state.selectedId = plays[0].id; }); toast(`已导入 ${plays.length} 个战术。`); delete actions['confirm-import'];
    };
  } catch (error) { toast(`导入失败：${error.message}`, { type: 'error' }); }
  event.target.value = '';
});
document.addEventListener('keydown', event => {
  if (maddenLibrary.isOpen) { if (event.key === 'Escape') maddenLibrary.close(); return; }
  const modal = $('.modal');
  if (modal) {
    if (event.key === 'Escape') { pendingNavigation=null; closeModal(); }
    if (event.key === 'Enter' && event.target.matches('input') && !event.target.closest('form')) { const primary=modal.querySelector('footer .button.primary:not(:disabled)'); if(primary){event.preventDefault();primary.click();} }
    if (event.key === 'Tab') { const inputs = [...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(n => !n.disabled); const first = inputs[0], last = inputs.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); restore(event.shiftKey ? history.redo(state) : history.undo(state)); return; }
  if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); restore(history.redo(state)); return; }
  if (event.key === ' ') { event.preventDefault(); togglePlay(); }
  else if (event.key === 'Enter' && draft) { event.preventDefault(); finishRoute(); }
  else if (event.key === 'Escape') { sidebarOpen = false; draft = null; selection = null; tool = 'select'; render(); }
  else if (event.key==='Backspace' && draft) {event.preventDefault();actions['undo-point']();}
  else if (event.key === 'Delete' || event.key === 'Backspace') {event.preventDefault();if(!rehearsal)deleteSelected();}
  else if (key === '?') helpModal();
  else if (canEdit() && !event.ctrlKey && !event.metaKey && ({ v: 'select', r: 'route', b: 'block', m: 'motion', p: 'pass', z: 'zone', t: 'text' })[key]) {setTool(({v:'select',r:'route',b:'block',m:'motion',p:'pass',z:'zone',t:'text'})[key]);}
});
initEffects();
render();
if (loadIssue) toast(loadIssue);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});

if (cloudMode()) {
  document.body.classList.add('cloud-enabled');
  shared = new SharedWorkspace({
    onData(data) {
      resetAnimation(); selection = null; draft = null; drag = null;
      const selectedId = data.plays.some(p => p.id === state.selectedId) ? state.selectedId : data.plays[0].id;
      state = { data, selectedId }; book = current().book; query = ''; filter = ''; formationFilter = '';
      history.past = []; history.future = []; render();
    },
    onStatus(value) { saveState = value; $('#save-state')?.replaceChildren(document.createTextNode(value)); },
    onPermissionLost(error) { resetAnimation(); draft = null; drag = null; render(); toast(error.message || '访问权限已变更，请重新登录或联系管理员。', { type: 'error' }); },
    showEditor(show) { if (!show) maddenLibrary.close(); $('#app').hidden = !show; $('.skip-link').hidden = !show; },
    isBusy: () => !!drag || !!draft || playing || !!$('.modal') || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName),
    openModal, closeModal, toast, download
  });
  shared.init();
} else if (location.hostname !== 'localhost') {
  $('#cloud-root').innerHTML = `<div class="cloud-local-entry"><span>本地离线预览 · 修改仅保存在此浏览器</span><a class="button primary" href="${CLOUD_SITE}/editor/index.html" target="_top">进入云端共享版</a></div>`;
}
