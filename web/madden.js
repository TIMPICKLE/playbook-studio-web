import { escapeHTML as e } from './model.js';
import { filterCatalog, MADDEN_DRAG_TYPE } from './madden-model.js';

export function createMaddenLibrary({ canEdit, getPlays, onImport, notify }) {
  let root, catalog, loading, opened = false, failure = '', team = 'eagles', group = '', formation = '', query = '', page = 1, preview = null, returnFocus;
  const pageSize = 30;
  const imported = () => new Set(getPlays().map(p => p.reference?.catalogId).filter(Boolean));
  const entry = id => catalog?.plays.find(p => p.id === id);
  const options = (values, selected) => values.map(v => `<option value="${e(v)}" ${v === selected ? 'selected' : ''}>${e(v)}</option>`).join('');
  function attach() {
    root = document.querySelector('#madden-root');
    root.addEventListener('click', event => {
      const b = event.target.closest('[data-madden]'); if (!b || b.disabled) return;
      const action = b.dataset.madden, id = b.dataset.id;
      if (action === 'close') close();
      if (action === 'retry') { loading = null; load(); }
      if (action === 'team') { team = id; group = ''; formation = ''; page = 1; preview = null; render(); }
      if (action === 'preview') { preview = id; render(); root.querySelector('[data-madden="back"]')?.focus(); }
      if (action === 'back') { const prior = preview; preview = null; render(); root.querySelector(`[data-madden="preview"][data-id="${prior}"]`)?.focus(); }
      if (action === 'add') add(id);
      if (action === 'clear') { group = ''; formation = ''; query = ''; page = 1; render(); }
      if (action === 'prev' || action === 'next') { page += action === 'next' ? 1 : -1; render(); root.querySelector('.madden-results')?.scrollTo?.(0, 0); }
    });
    root.addEventListener('input', event => {
      if (event.target.id !== 'madden-search') return;
      query = event.target.value; page = 1; renderResults();
    });
    root.addEventListener('change', event => {
      if (event.target.id === 'madden-group') { group = event.target.value; formation = ''; }
      else if (event.target.id === 'madden-formation') formation = event.target.value;
      else return;
      page = 1; render();
    });
    root.addEventListener('dragstart', event => {
      const card = event.target.closest('[data-madden-card]');
      if (!card || !canEdit() || imported().has(card.dataset.maddenCard)) { event.preventDefault(); return; }
      event.dataTransfer.setData(MADDEN_DRAG_TYPE, card.dataset.maddenCard);
      event.dataTransfer.effectAllowed = 'copy';
      document.body.classList.add('madden-dragging');
    });
    document.addEventListener('dragend', clearDrag);
    document.addEventListener('dragover', event => {
      if (!event.dataTransfer?.types.includes(MADDEN_DRAG_TYPE)) return;
      const target = event.target.closest('[data-madden-drop]');
      document.querySelectorAll('.madden-drop-hover').forEach(n => n.classList.toggle('madden-drop-hover', n === target));
      if (target && canEdit()) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; target.classList.add('madden-drop-hover'); }
    });
    document.addEventListener('drop', event => {
      if (!event.dataTransfer?.types.includes(MADDEN_DRAG_TYPE)) return;
      event.preventDefault();
      const target = event.target.closest('[data-madden-drop]'), id = event.dataTransfer.getData(MADDEN_DRAG_TYPE);
      clearDrag(); if (target) add(id);
    });
    root.addEventListener('keydown', event => {
      // Keep editor shortcuts from operating on the play behind the library.
      event.stopPropagation();
      if (event.key === 'Escape') { if (preview) { preview = null; render(); } else close(); }
    });
  }
  function clearDrag() { document.body.classList.remove('madden-dragging'); document.querySelectorAll('.madden-drop-hover').forEach(n => n.classList.remove('madden-drop-hover')); }
  function add(id) {
    const play = entry(id); if (!play) { notify('这条战术不在当前目录中，请重新选择。'); return; }
    if (!canEdit()) { notify('当前为只读权限，无法加入战术。'); return; }
    if (imported().has(id)) { notify('这条战术已经在当前战术本中。'); return; }
    onImport(play); render();
  }
  async function load() {
    failure = ''; render();
    if (!loading) loading = fetch(new URL('./data/huddle-catalog.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('load'); return r.json(); }).then(data => { if (data.schemaVersion !== 1 || !data.plays?.length || data.teams?.length !== 2) throw new Error('invalid'); catalog = data; }).catch(() => { failure = '战术目录暂时未能加载，请重试。'; loading = null; }).finally(render);
    await loading;
  }
  function renderResults() {
    const results = root?.querySelector('.madden-results'); if (!results || !catalog) return;
    const matches = filterCatalog(catalog, { team, group, formation, query }), added = imported();
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize)); page = Math.max(1, Math.min(page, totalPages));
    root.querySelector('#madden-count').textContent = `${matches.length} 个战术`;
    results.innerHTML = matches.length ? `<div class="madden-cards">${matches.slice((page - 1) * pageSize, page * pageSize).map(p => `<article class="madden-card ${added.has(p.id) ? 'is-imported' : ''}" data-madden-card="${e(p.id)}" draggable="${canEdit() && !added.has(p.id)}"><button class="madden-art" data-madden="preview" data-id="${e(p.id)}" aria-label="预览 ${e(p.name)}"><img src="./${e(p.image)}" alt="${e(p.name)} · ${e(p.group)} ${e(p.formation)} 战术图" loading="lazy" draggable="false"><span class="madden-art-hint">点击放大</span></button><div class="madden-card-body"><small>${e(p.group)} / ${e(p.formation)}</small><h3>${e(p.name)}</h3><div class="madden-card-foot"><span>${added.has(p.id) ? '✓ 已在战术本' : '⠿ 拖入战术本'}</span><button data-madden="add" data-id="${e(p.id)}" aria-label="加入 ${e(p.name)}" ${!canEdit() || added.has(p.id) ? 'disabled' : ''}>${added.has(p.id) ? '已加入' : '＋ 加入'}</button></div></div></article>`).join('')}</div><nav class="madden-pagination" aria-label="战术分页"><button data-madden="prev" ${page === 1 ? 'disabled' : ''}>← 上一页</button><span>${page} / ${totalPages}</span><button data-madden="next" ${page === totalPages ? 'disabled' : ''}>下一页 →</button></nav>` : '<div class="madden-empty"><strong>没有匹配的战术</strong><p>试试战术英文名，例如 Inside Zone、Mesh。</p><button data-madden="clear">清除筛选</button></div>';
  }
  function render() {
    if (!root || !opened) return;
    const scrollTop = root.querySelector('.madden-results')?.scrollTop || 0;
    const selectedTeam = catalog?.teams.find(t => t.id === team);
    const allTeamPlays = catalog?.plays.filter(p => p.team === team) || [];
    const groups = [...new Set(allTeamPlays.map(p => p.group))];
    const formations = [...new Set(allTeamPlays.filter(p => !group || p.group === group).map(p => `${p.group} ${p.formation}`))];
    root.hidden = false;
    root.innerHTML = `<section class="madden-panel" aria-label="Madden NFL 战术库"><header class="madden-header"><div><small>PLAYBOOK COLLECTION / ${e(selectedTeam?.game || 'MADDEN NFL')}</small><h2>Madden 战术库 <span>进攻</span></h2></div><button class="madden-close" data-madden="close" aria-label="关闭 Madden 战术库">✕</button></header><div class="madden-team-tabs" role="group" aria-label="选择球队">${[['eagles','PHI','Eagles','Philadelphia'],['ravens','BAL','Ravens','Baltimore']].map(([id,code,name,city]) => `<button class="madden-team ${id === team ? 'active' : ''}" data-madden="team" data-id="${id}" aria-pressed="${id === team}"><span class="madden-team-code ${id}">${code}</span><span><strong>${name}</strong><small>${city}</small></span><em>${catalog?.teams.find(t => t.id === id)?.playCount ?? '—'}</em></button>`).join('')}</div>${catalog ? `<div class="madden-filterbar"><input id="madden-search" type="search" value="${e(query)}" aria-label="搜索 Madden 战术" placeholder="搜索战术或阵型 · Inside Zone, Mesh…"><div><select id="madden-group" aria-label="Madden 阵型大类"><option value="">全部阵型大类</option>${options(groups, group)}</select><select id="madden-formation" aria-label="Madden 具体阵型"><option value="">全部具体阵型</option>${options(formations, formation)}</select></div></div><div class="madden-result-heading"><strong id="madden-count"></strong><span>${canEdit() ? '拖到左侧进攻战术本，或点「＋ 加入」' : '只读权限 · 可浏览和预览'}</span></div><div class="madden-results"></div><footer class="madden-footer"><span>原始战术图 · ${e(selectedTeam.game)} · ${catalog.fetchedAt.slice(0,10)}</span><a href="${e(selectedTeam.sourceUrl)}" target="_blank" rel="noopener noreferrer">来源 Huddle.gg ↗</a></footer>` : `<div class="madden-empty" role="status">${failure ? `${e(failure)}<button data-madden="retry">重新加载</button>` : '正在加载两队战术目录…'}</div>`}</section>`;
    renderResults();
    const results = root.querySelector('.madden-results'); if (results) results.scrollTop = scrollTop;
    if (preview && entry(preview)) {
      const p = entry(preview), added = imported().has(p.id);
      root.querySelector('.madden-panel').insertAdjacentHTML('beforeend', `<div class="madden-detail"><button data-madden="back" class="madden-back">← 返回战术库</button><small>${e(p.game)} · ${e(p.team === 'eagles' ? 'Eagles' : 'Ravens')}</small><h2>${e(p.name)}</h2><p>${e(p.group)} / ${e(p.formation)}</p><img src="./${e(p.image)}" alt="${e(p.name)} 原始战术图"><p class="madden-reference-note">保留原图与来源。加入后可记录教练笔记、收藏、导出和打印。原图没有可播放的路线坐标。</p><button class="button primary" data-madden="add" data-id="${e(p.id)}" ${!canEdit() || added ? 'disabled' : ''}>${added ? '✓ 已在当前战术本' : '＋ 加入进攻战术本'}</button><a href="${e(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看 Huddle.gg 原页面 ↗</a></div>`);
    }
  }
  async function open() { if (!root) attach(); opened = true; returnFocus = document.activeElement; document.body.classList.add('madden-open'); render(); root.querySelector('[data-madden="close"]')?.focus(); if (!catalog) await load(); }
  function close() { opened = false; preview = null; if (root) { root.hidden = true; root.innerHTML = ''; } document.body.classList.remove('madden-open'); clearDrag(); if (returnFocus?.isConnected) returnFocus.focus(); else document.querySelector('[data-action="madden-library"]')?.focus(); }
  return { open, close, refresh: render, get isOpen() { return opened; } };
}
