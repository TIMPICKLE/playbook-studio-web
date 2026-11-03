import { t } from './i18n.js';
import { escapeHTML as e, uid } from './model.js';
import { createPersonnelGroups } from './personnel-groups.js';
import { createDepthChartView } from './depth-chart.js';

const leagues = [6, 7, 8, 9, 11, 12];
const teamValues = data => ({ ...data.team, league: data.settings.league });

function playerRow(player, editable) {
  return `<tr>
    <td class="roster-jersey">${e(player.number) || '—'}</td>
    <th scope="row">${e(player.name)}</th>
    <td>${player.position ? `<span class="roster-position">${e(player.position)}</span>` : '—'}</td>
    ${editable ? `<td><button type="button" class="roster-text" data-roster="edit" data-id="${e(player.id)}" aria-label="${e(t('roster.editNamed', { name: player.name }))}">${t('roster.edit')}</button></td>` : ''}
  </tr>`;
}

function input(label, name, value, attrs) {
  return `<label>${t(label)}<input name="${name}" value="${e(value)}" ${attrs}></label>`;
}

function editorFields(type, values) {
  if (type === 'team') {
    return `${input('modal.team_name', 'name', values.name, 'maxlength="80" required autofocus')}
      ${input('modal.season_subtitle', 'subtitle', values.subtitle, 'maxlength="80"')}
      <div class="roster-pair">${input('modal.team_color', 'accent', values.accent, 'type="color"')}
      <label>${t('modal.default_players')}<select name="league">${leagues.map(n => `<option value="${n}" ${n === values.league ? 'selected' : ''}>${t('roster.league', { count: n })}</option>`).join('')}</select></label></div>`;
  }
  return `${input('modal.player_name', 'name', values.name, 'maxlength="80" required autofocus')}
    <div class="roster-pair">${input('modal.jersey_number', 'number', values.number, 'maxlength="5"')}
    ${input('modal.player_position', 'position', values.position, 'maxlength="15" placeholder="QB, WR, CB…"')}</div>`;
}

export function createRosterView({ root, getData, getWorkspaceId, canEdit, commit }) {
  let draft = null;
  let pane = 'depth', groups, chart;
  const find = selector => root.querySelector(selector);
  const dialog = () => find('[aria-labelledby="roster-form-title"]');
  const notice = message => { find('.roster-notice').textContent = message; };
  const error = message => { dialog().querySelector('.roster-error').textContent = message; };

  function renderList() {
    const data = getData(), editable = canEdit();
    const query = find('.roster-tools [type="search"]').value.trim().toLocaleLowerCase();
    const rows = data.roster.filter(player => [player.name, player.number, player.position].some(value => value.toLocaleLowerCase().includes(query)));
    find('.roster-count').textContent = query ? `${rows.length} / ${data.roster.length}` : String(data.roster.length);
    find('.roster-results').innerHTML = rows.length ? `<table aria-labelledby="roster-directory"><thead><tr>
      <th scope="col">${t('modal.number')}</th><th scope="col">${t('modal.name')}</th><th scope="col">${t('modal.position')}</th>
      ${editable ? `<th scope="col">${t('roster.actions')}</th>` : ''}</tr></thead>
      <tbody>${rows.map(player => playerRow(player, editable)).join('')}</tbody></table>` :
      `<div class="roster-empty"><p>${t(query ? 'roster.noMatches' : 'roster.empty')}</p>${query ? `<button type="button" data-roster="clear" class="roster-text">${t('roster.clearSearch')}</button>` : ''}</div>`;
  }

  function refresh() {
    if (root.hidden) return;
    const data = getData(), editable = canEdit();
    find('.roster-team-name').textContent = data.team.name;
    find('.roster-team-meta').textContent = [data.team.subtitle, t('roster.league', { count: data.settings.league })].filter(Boolean).join(' · ');
    find('.roster-team').style.setProperty('--roster-accent', data.team.accent);
    find('[data-roster="team"]').hidden = !editable;
    const add = find('[data-roster="add"]');
    add.hidden = !editable;
    add.disabled = data.roster.length >= 200;
    add.title = add.disabled ? t('editorExtra.the_roster_can_contain_at_most_200_players') : '';
    find('.roster-readonly').hidden = editable;
    renderList();
    if (pane === 'depth') {
      groups.refresh();
      chart.refresh();
    }
    if (draft) {
      const blocked = draft.workspace !== getWorkspaceId() || !editable;
      dialog().querySelector('[type="submit"]').disabled = blocked;
      if (blocked) error(t(draft.workspace !== getWorkspaceId() ? 'roster.workspaceChanged' : 'roster.permissionChanged'));
    }
  }

  function selectPane(next, focus = false) {
    pane = next;
    for (const tab of root.querySelectorAll('[data-roster-tab]')) {
      const active = tab.dataset.rosterTab === next;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      find('#' + tab.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) tab.focus();
    }
    refresh();
  }

  function show(visible) {
    if (visible && !root.hidden && find('.roster-page')) { refresh(); return; }
    root.hidden = !visible;
    if (!visible) {
      if (dialog()?.open) dialog().close();
      chart?.destroy();
      groups?.destroy();
      chart = groups = null;
      root.replaceChildren();
      draft = null;
      return;
    }
    root.innerHTML = `<main class="roster-page">
      <button type="button" data-cloud-action="home" class="roster-back">← ${t('extra.backToWorkspace')}</button>
      <header class="roster-heading"><h1 tabindex="-1">${t('roster.title')}</h1></header>
      <div class="roster-team"><div><strong class="roster-team-name"></strong><p class="roster-team-meta"></p></div>
        <button type="button" data-roster="team" class="roster-secondary">${t('roster.teamSettings')}</button>
        <span class="roster-readonly">${t('roster.readOnly')}</span></div>
      <div class="roster-tabs" role="tablist" aria-label="${t('roster.title')}">
        <button type="button" role="tab" id="roster-depth-tab" data-roster-tab="depth" aria-controls="roster-depth-pane">${t('roster.depthTab')}</button>
        <button type="button" role="tab" id="roster-directory-tab" data-roster-tab="directory" aria-controls="roster-directory-pane">${t('roster.directory')}</button>
      </div>
      <section id="roster-depth-pane" role="tabpanel" aria-labelledby="roster-depth-tab">
        <div class="roster-groups-root"></div><div class="roster-chart-root"></div>
      </section>
      <section id="roster-directory-pane" class="roster-panel" role="tabpanel" aria-labelledby="roster-directory-tab"><div class="roster-tools">
        <h2 id="roster-directory">${t('roster.directory')} <span class="roster-count" aria-live="polite"></span></h2>
        <input type="search" aria-label="${t('roster.search')}" placeholder="${t('roster.search')}">
        <button type="button" data-roster="add" class="roster-primary"><span aria-hidden="true">＋</span> ${t('roster.add')}</button></div>
        <div class="roster-results"></div></section><p class="roster-notice" role="status"></p>
      <dialog class="roster-dialog" aria-labelledby="roster-form-title"></dialog>
    </main>`;
    const context = { getData, getWorkspaceId, canEdit, commit };
    groups = createPersonnelGroups({ ...context, root: find('.roster-groups-root'), onSelect: () => chart?.refresh() });
    chart = createDepthChartView({ ...context, root: find('.roster-chart-root'), getSelectedId: () => groups.getSelectedId(), onChange: () => groups.refresh() });
    selectPane('depth');
    find('h1').focus({ preventScroll: true });
  }

  function openEditor(type, id) {
    if (!canEdit() || dialog().open) return;
    const data = getData();
    if (type === 'add' && data.roster.length >= 200) return;
    let values = { name: '', number: '', position: '' };
    if (type === 'edit') {
      values = data.roster.find(player => player.id === id);
      if (!values) return;
    }
    if (type === 'team') values = teamValues(data);
    draft = { type, workspace: getWorkspaceId(), before: { ...values } };
    const title = { add: 'roster.add', edit: 'roster.editPlayer', team: 'roster.teamSettings' }[type];
    dialog().innerHTML = `<form><h2 id="roster-form-title">${t(title)}</h2><div class="roster-fields">${editorFields(type, values)}</div>
      <p class="roster-error" role="alert"></p><div class="roster-dialog-actions">
      ${type === 'edit' ? `<button type="button" class="roster-remove" data-roster="remove">${t('roster.remove')}</button>` : ''}
      <button type="button" class="roster-secondary" data-roster="cancel">${t('modal.cancel')}</button>
      <button type="submit" class="roster-primary">${t('roster.save')}</button></div></form>`;
    dialog().showModal();
    dialog().querySelector('input[autofocus]').focus();
  }

  function closeEditor(focusId) {
    const type = draft.type;
    dialog().close();
    draft = null;
    refresh();
    const target = type !== 'team' && focusId && [...root.querySelectorAll('[data-roster="edit"]')].find(node => node.dataset.id === focusId);
    (target || find(`[data-roster="${type === 'team' ? 'team' : 'add'}"]`))?.focus();
  }

  function submit(remove = false) {
    if (!draft || !dialog().open) return;
    if (draft.workspace !== getWorkspaceId() || !canEdit()) { refresh(); return; }
    const { type, before } = draft, form = dialog().querySelector('form');
    const isTeam = type === 'team';
    const data = getData();
    const current = isTeam ? teamValues(data) : data.roster.find(player => player.id === before.id);
    if (type !== 'add' && !current) { error(t('roster.conflict')); return; }
    const values = Object.fromEntries([...form.elements].filter(field => field.name).map(field => [field.name, field.name === 'league' ? Number(field.value) : field.value.trim()]));
    const changes = Object.entries(values).filter(([key, value]) => value !== before[key]);
    // Apply just changed fields. Preserve edits from another member on this row or another row.
    const compare = remove ? Object.entries(before) : changes;
    if (current && compare.some(([key]) => current[key] !== before[key])) { error(t('roster.conflict')); return; }
    if (!remove && !values.name) { error(t(isTeam ? 'roster.teamRequired' : 'roster.required')); form.elements.namedItem('name').focus(); return; }
    if (remove && !root.ownerDocument.defaultView.confirm(t('roster.confirmRemove', { name: before.name }))) return;
    if (type === 'add' && data.roster.length >= 200) { error(t('editorExtra.the_roster_can_contain_at_most_200_players')); return; }
    if (!remove && type !== 'add' && !changes.length) { closeEditor(before.id); return; }
    const id = before.id || (type === 'add' ? uid() : null);
    const ok = commit(latest => {
      if (remove) latest.roster = latest.roster.filter(player => player.id !== id);
      else if (type === 'add') latest.roster.push({ id, ...values });
      else if (isTeam) {
        for (const [key, value] of changes) {
          if (key === 'league') latest.settings.league = value;
          else latest.team[key] = value;
        }
      } else Object.assign(latest.roster.find(player => player.id === id), Object.fromEntries(changes));
    });
    if (ok === false) { error(t('roster.saveFailed')); return; }
    closeEditor(remove ? null : id);
    notice(t(isTeam ? 'roster.teamUpdated' : 'roster.updated'));
  }

  root.addEventListener('click', event => {
    const tab = event.target.closest('[data-roster-tab]');
    if (tab && !root.hidden) { selectPane(tab.dataset.rosterTab, true); return; }
    const button = event.target.closest('[data-roster]');
    if (root.hidden || !button || button.disabled) return;
    switch (button.dataset.roster) {
      case 'add': case 'team': case 'edit': openEditor(button.dataset.roster, button.dataset.id); break;
      case 'remove': submit(true); break;
      case 'cancel': closeEditor(draft.before.id); break;
      case 'clear': find('.roster-tools [type="search"]').value = ''; renderList(); find('.roster-tools [type="search"]').focus(); break;
    }
  });
  root.addEventListener('keydown', event => {
    if (!event.target.closest('[data-roster-tab]')) return;
    if (!['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') selectPane('depth', true);
    else if (event.key === 'End') selectPane('directory', true);
    else selectPane(pane === 'depth' ? 'directory' : 'depth', true);
  });
  root.addEventListener('input', event => { if (event.target.matches('.roster-tools [type="search"]')) renderList(); });
  root.addEventListener('submit', event => {
    if (dialog()?.contains(event.target)) { event.preventDefault(); submit(); }
  });
  root.addEventListener('cancel', event => {
    if (event.target !== dialog() || !draft) return;
    event.preventDefault();
    closeEditor(draft.before.id);
  }, true);
  return { show, refresh, isEditing: () => !!(dialog()?.open || groups?.isEditing() || chart?.isEditing()) };
}
