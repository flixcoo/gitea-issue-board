/* global Sortable */

import { hasMessage, t, translateDocument } from './i18n.js';

const $ = (id) => document.getElementById(id);

const state = {
  me: null,
  repo: null, // "owner/name"
  board: null, // { repo, labels, scopes, issues }
  scope: null,
  filter: '',
  loadedAt: 0,
  dragging: false,
  sortables: [],
};

// ---------- helpers ----------

const scopeOf = (name) => {
  const i = name.lastIndexOf('/');
  return i > 0 ? name.slice(0, i) : null;
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function textColorFor(hex) {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? [...c].map((x) => x + x).join('') : c.padEnd(6, '0');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#1a1a1a' : '#ffffff';
}

// Same algorithm Gitea uses for scoped labels: scope part slightly darker,
// item part slightly lighter than the label color.
function scopedLabelColors(hex) {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? [...c].map((x) => x + x).join('') : c.padEnd(6, '0');
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const lum = (0.2126729 * rgb[0] + 0.7151522 * rgb[1] + 0.072175 * rgb[2]) / 255;
  const contrast = 0.01 + lum * 0.03;
  const darken = contrast + Math.max(lum + contrast - 1, 0);
  const lighten = contrast + Math.max(contrast - lum, 0);
  const base = Math.max(lum, 1 / 255);
  const darkF = Math.max(lum - darken, 0) / base;
  const lightF = Math.min(lum + lighten, 1) / base;
  const mix = (f) => `rgb(${rgb.map((v) => Math.min(255, Math.round(v * f))).join(',')})`;
  return { scope: mix(darkF), item: mix(lightF) };
}

let toastTimer;
function toast(message, kind = 'error') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

class AuthError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'X-Requested-With': 'issue-board',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    showLogin();
    throw new AuthError(t('error.not_authenticated'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const key = `error.${data.error}`;
    throw new Error(data.message || (hasMessage(key) ? t(key) : t('error.status', { status: res.status })));
  }
  return data;
}

function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const repoApiPath = () => '/repos/' + state.repo.split('/').map(encodeURIComponent).join('/');

// ---------- URL state ----------

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { repo: p.get('repo'), scope: p.get('scope') };
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.repo) p.set('repo', state.repo);
  if (state.scope) p.set('scope', state.scope);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ---------- views ----------

function showLogin() {
  $('app-view').hidden = true;
  $('login-view').hidden = false;
  const returnTo = location.pathname + location.search.replace(/[?&]login_error=[^&]*/, '');
  $('login-btn').href = `/auth/login?returnTo=${encodeURIComponent(returnTo || '/')}`;
  const err = new URLSearchParams(location.search).get('login_error');
  if (err) {
    $('login-error').textContent = t('login.failed', { error: err });
    $('login-error').hidden = false;
  }
}

function showEmpty(message) {
  $('board').replaceChildren();
  $('empty-state').hidden = false;
  $('empty-state').replaceChildren(...(Array.isArray(message) ? message : [message]));
}

// ---------- board model ----------

function scopeLabels() {
  const labels = state.board.labels.filter((l) => l.scope === state.scope);
  const order = storageGet(`order:${state.repo}:${state.scope}`, []);
  const pos = (l) => {
    const i = order.indexOf(l.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return labels.sort((a, b) => pos(a) - pos(b) || a.name.localeCompare(b.name));
}

function columns() {
  return [
    { key: 'open', kind: 'open', title: t('col.open') },
    ...scopeLabels().map((l) => ({
      key: `label:${l.id}`,
      kind: 'label',
      label: l,
      title: l.name.slice(state.scope.length + 1),
    })),
    { key: 'closed', kind: 'closed', title: t('col.closed') },
  ];
}

function issuesFor(col) {
  const inScope = (i) => i.labels.filter((l) => scopeOf(l.name) === state.scope);
  return state.board.issues.filter((i) => {
    if (col.kind === 'closed') return i.state === 'closed';
    if (i.state !== 'open') return false;
    if (col.kind === 'open') return inScope(i).length === 0;
    return i.labels.some((l) => l.id === col.label.id);
  });
}

function matchesFilter(issue) {
  const q = state.filter.trim().toLowerCase();
  if (!q) return true;
  return q.split(/\s+/).every((term) => {
    if (term.startsWith('#')) return String(issue.number) === term.slice(1);
    if (term.startsWith('@')) return issue.assignees.some((a) => a.login.toLowerCase().includes(term.slice(1)));
    return (
      issue.title.toLowerCase().includes(term) ||
      String(issue.number) === term ||
      issue.labels.some((l) => l.name.toLowerCase().includes(term)) ||
      issue.assignees.some((a) => a.login.toLowerCase().includes(term)) ||
      (issue.milestone || '').toLowerCase().includes(term)
    );
  });
}

// ---------- rendering ----------

function labelChip(label) {
  const chip = el('span', { class: 'label', title: label.description || label.name });
  if (label.scope) {
    chip.classList.add('scoped');
    const s = el('span', { class: 'label-scope' }, label.scope);
    const v = el('span', { class: 'label-value' }, label.name.slice(label.scope.length + 1));
    const { scope, item } = scopedLabelColors(label.color);
    const fg = textColorFor(label.color);
    s.style.background = scope;
    v.style.background = item;
    s.style.color = v.style.color = fg;
    chip.append(s, v);
  } else {
    chip.textContent = label.name;
    chip.style.background = label.color;
    chip.style.color = textColorFor(label.color);
  }
  return chip;
}

function card(issue, col) {
  const labels = issue.labels.filter((l) => col.kind === 'closed' || scopeOf(l.name) !== state.scope);
  return el(
    'article',
    { class: `card${issue.state === 'closed' ? ' closed' : ''}`, dataset: { number: issue.number } },
    el(
      'div',
      { class: 'card-title' },
      el('a', { href: issue.url, target: '_blank', rel: 'noopener' }, issue.title),
    ),
    labels.length ? el('div', { class: 'card-labels' }, labels.map(labelChip)) : null,
    el(
      'div',
      { class: 'card-meta' },
      el('span', { class: 'card-number' }, `#${issue.number}`),
      issue.milestone ? el('span', { class: 'card-milestone', title: t('card.milestone') }, `◷ ${issue.milestone}`) : null,
      issue.comments ? el('span', { class: 'card-comments', title: t('card.comments') }, `💬 ${issue.comments}`) : null,
      el(
        'span',
        { class: 'card-assignees' },
        issue.assignees.map((a) => el('img', { class: 'avatar small', src: a.avatar, alt: a.login, title: a.login })),
      ),
    ),
  );
}

function render() {
  if (state.dragging) return;
  state.sortables.forEach((s) => s.destroy());
  state.sortables = [];

  const board = $('board');
  if (!state.board) return;
  if (!state.scope) {
    showEmpty([
      el('h2', {}, t('empty.noScopes.title')),
      el(
        'p',
        {},
        t('empty.noScopes.before'),
        el('code', {}, 'scope/name'),
        t('empty.noScopes.example'),
        el('code', {}, 'status/todo'),
        ', ',
        el('code', {}, 'status/in-progress'),
        t('empty.noScopes.after'),
      ),
    ]);
    return;
  }
  $('empty-state').hidden = true;

  const cols = columns().map((col) => {
    const issues = issuesFor(col);
    const visible = issues.filter(matchesFilter);
    const header = el(
      'header',
      { class: 'col-header' },
      col.kind === 'label' ? el('span', { class: 'dot' }) : null,
      el('h2', { title: col.label?.description || col.title }, col.title),
      el('span', { class: 'count' }, visible.length === issues.length ? issues.length : `${visible.length}/${issues.length}`),
    );
    if (col.kind === 'label') header.querySelector('.dot').style.background = col.label.color;

    const list = el('div', { class: 'col-list', dataset: { col: col.key } }, visible.map((i) => card(i, col)));
    const footer =
      col.kind === 'closed' && issues.length >= state.board.closedLimit
        ? el('footer', { class: 'col-footer' }, t('col.closedLimit', { count: state.board.closedLimit }))
        : null;

    return el(
      'section',
      { class: `col col-${col.kind}${col.kind === 'label' ? ' movable' : ''}`, dataset: { col: col.key } },
      header,
      list,
      footer,
    );
  });
  board.replaceChildren(...cols);

  const canWrite = state.board.repo.canWrite;
  for (const list of board.querySelectorAll('.col-list')) {
    state.sortables.push(
      Sortable.create(list, {
        group: 'issues',
        sort: false,
        disabled: !canWrite,
        animation: 150,
        ghostClass: 'card-ghost',
        dragClass: 'card-drag',
        onStart: () => (state.dragging = true),
        onEnd: (evt) => {
          state.dragging = false;
          if (evt.from === evt.to) return;
          moveIssue(Number(evt.item.dataset.number), evt.from.dataset.col, evt.to.dataset.col);
        },
      }),
    );
  }

  // Column order (label columns only), persisted per repo + scope in localStorage.
  state.sortables.push(
    Sortable.create(board, {
      handle: '.col-header',
      draggable: '.movable',
      animation: 150,
      onMove: (evt) => evt.related.classList.contains('movable'),
      onStart: () => (state.dragging = true),
      onEnd: () => {
        state.dragging = false;
        const order = [...board.querySelectorAll('.col.movable')].map((c) => Number(c.dataset.col.split(':')[1]));
        storageSet(`order:${state.repo}:${state.scope}`, order);
      },
    }),
  );
}

function renderScopeSelect() {
  const select = $('scope-select');
  const scopes = state.board?.scopes || [];
  select.replaceChildren(...scopes.map((s) => el('option', { value: s }, s)));
  select.disabled = scopes.length === 0;
  if (state.scope) select.value = state.scope;
}

// ---------- actions ----------

function targetFromKey(key) {
  if (key === 'open' || key === 'closed') return { column: key };
  return { column: 'label', labelId: Number(key.split(':')[1]) };
}

async function moveIssue(number, fromKey, toKey) {
  const issue = state.board.issues.find((i) => i.number === number);
  if (!issue) return;
  const target = targetFromKey(toKey);
  const snapshot = structuredClone(issue);

  // Optimistic update (same rules as the server)
  issue.labels = issue.labels.filter((l) => scopeOf(l.name) !== state.scope);
  if (target.column === 'label') issue.labels.push(state.board.labels.find((l) => l.id === target.labelId));
  issue.state = target.column === 'closed' ? 'closed' : 'open';
  render();

  try {
    const updated = await api(`${repoApiPath()}/issues/${number}/move`, {
      method: 'POST',
      body: { scope: state.scope, target },
    });
    Object.assign(issue, updated);
    render();
  } catch (e) {
    if (e instanceof AuthError) return;
    Object.assign(issue, snapshot);
    render();
    toast(t('toast.moveFailed', { number, error: e.message }));
  }
}

async function loadBoard({ silent = false } = {}) {
  if (!state.repo) {
    state.board = null;
    renderScopeSelect();
    $('repo-link').hidden = true;
    showEmpty([el('h2', {}, t('empty.chooseRepo.title')), el('p', {}, t('empty.chooseRepo.text'))]);
    return;
  }
  if (!silent) {
    $('board').classList.add('loading');
  }
  try {
    const board = await api(`${repoApiPath()}/board`);
    state.board = board;
    state.loadedAt = Date.now();
    if (!board.scopes.includes(state.scope)) {
      const remembered = storageGet(`scope:${state.repo}`, null);
      const preferred = ['status', 'workflow', 'state', 'stage', 'kanban', 'board'].find((s) => board.scopes.includes(s));
      state.scope = board.scopes.includes(remembered) ? remembered : preferred || board.scopes[0] || null;
    }
    storageSet('lastRepo', state.repo);
    if (state.scope) storageSet(`scope:${state.repo}`, state.scope);
    $('repo-link').href = `${board.repo.url}/issues`;
    $('repo-link').hidden = false;
    writeUrl();
    renderScopeSelect();
    render();
    if (!board.repo.canWrite) toast(t('toast.readOnly'), 'info');
  } catch (e) {
    if (e instanceof AuthError) return;
    if (!silent) {
      state.board = null;
      renderScopeSelect();
      showEmpty([el('h2', {}, t('empty.loadFailed')), el('p', {}, e.message)]);
    }
  } finally {
    $('board').classList.remove('loading');
  }
}

// ---------- repo picker ----------

const repoPicker = {
  repos: null, // [{ fullName, owner, name, description, private, archived }]
  loading: null,
  active: -1, // index into visible options
  visible: [],
};

async function loadRepos(force = false) {
  if (repoPicker.repos && !force) return repoPicker.repos;
  if (!repoPicker.loading) {
    repoPicker.loading = api('/repos')
      .then((repos) => (repoPicker.repos = repos))
      .finally(() => (repoPicker.loading = null));
  }
  return repoPicker.loading;
}

function renderRepoOptions() {
  const box = $('repo-options');
  const terms = $('repo-filter').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!repoPicker.repos) {
    box.replaceChildren(el('div', { class: 'dropdown-hint' }, t('repo.loading')));
    return;
  }
  repoPicker.visible = repoPicker.repos.filter((r) => {
    const hay = `${r.fullName} ${r.description}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  if (!repoPicker.visible.length) {
    box.replaceChildren(el('div', { class: 'dropdown-hint' }, t('repo.none')));
    return;
  }
  if (repoPicker.active >= repoPicker.visible.length) repoPicker.active = repoPicker.visible.length - 1;

  const nodes = [];
  let owner = null;
  repoPicker.visible.forEach((r, i) => {
    if (r.owner !== owner) {
      owner = r.owner;
      nodes.push(el('div', { class: 'dropdown-group', role: 'presentation' }, owner));
    }
    nodes.push(
      el(
        'div',
        {
          class: `dropdown-option${i === repoPicker.active ? ' active' : ''}${r.fullName === state.repo ? ' selected' : ''}`,
          role: 'option',
          id: `repo-opt-${i}`,
          'aria-selected': r.fullName === state.repo ? 'true' : 'false',
          title: r.description || r.fullName,
          onmousedown: (e) => e.preventDefault(),
          onclick: () => pickRepo(r.fullName),
          onmousemove: () => setActiveRepo(i, false),
        },
        el('span', { class: 'repo-name' }, r.name),
        r.private ? el('span', { class: 'repo-badge' }, t('repo.private')) : null,
        r.archived ? el('span', { class: 'repo-badge' }, t('repo.archived')) : null,
      ),
    );
  });
  box.replaceChildren(...nodes);
  $('repo-filter').setAttribute('aria-activedescendant', repoPicker.active >= 0 ? `repo-opt-${repoPicker.active}` : '');
}

function setActiveRepo(i, scroll = true) {
  if (i === repoPicker.active) return;
  $(`repo-opt-${repoPicker.active}`)?.classList.remove('active');
  repoPicker.active = i;
  const node = $(`repo-opt-${i}`);
  node?.classList.add('active');
  if (scroll) node?.scrollIntoView({ block: 'nearest' });
  $('repo-filter').setAttribute('aria-activedescendant', node ? node.id : '');
}

async function openRepoMenu() {
  $('repo-menu').hidden = false;
  $('repo-btn').setAttribute('aria-expanded', 'true');
  $('repo-filter').value = '';
  $('repo-filter').focus();
  repoPicker.active = -1;
  renderRepoOptions();
  try {
    await loadRepos();
  } catch (e) {
    if (e instanceof AuthError) return;
    $('repo-options').replaceChildren(el('div', { class: 'dropdown-hint error' }, e.message));
    return;
  }
  if ($('repo-menu').hidden) return;
  const current = repoPicker.repos.findIndex((r) => r.fullName === state.repo);
  repoPicker.active = current >= 0 ? current : 0;
  renderRepoOptions();
  $(`repo-opt-${repoPicker.active}`)?.scrollIntoView({ block: 'center' });
}

function closeRepoMenu({ focus = false } = {}) {
  if ($('repo-menu').hidden) return;
  $('repo-menu').hidden = true;
  $('repo-btn').setAttribute('aria-expanded', 'false');
  if (focus) $('repo-btn').focus();
}

function pickRepo(fullName) {
  closeRepoMenu({ focus: true });
  selectRepo(fullName);
}

function updateRepoButton() {
  $('repo-btn-text').textContent = state.repo || t('repo.choose');
  $('repo-btn-text').classList.toggle('placeholder', !state.repo);
}

function initRepoPicker() {
  updateRepoButton();
  $('repo-btn').addEventListener('click', () => ($('repo-menu').hidden ? openRepoMenu() : closeRepoMenu()));
  $('repo-filter').addEventListener('input', () => {
    repoPicker.active = 0;
    renderRepoOptions();
    $('repo-options').scrollTop = 0;
  });
  $('repo-filter').addEventListener('keydown', (e) => {
    const n = repoPicker.visible.length;
    if (e.key === 'ArrowDown' && n) setActiveRepo(Math.min(repoPicker.active + 1, n - 1));
    else if (e.key === 'ArrowUp' && n) setActiveRepo(Math.max(repoPicker.active - 1, 0));
    else if (e.key === 'Enter') {
      const r = repoPicker.visible[repoPicker.active];
      if (r) pickRepo(r.fullName);
    } else if (e.key === 'Escape') closeRepoMenu({ focus: true });
    else return;
    e.preventDefault();
  });
  document.addEventListener('mousedown', (e) => {
    if (!$('repo-dropdown').contains(e.target)) closeRepoMenu();
  });
  $('repo-dropdown').addEventListener('focusout', (e) => {
    if (e.relatedTarget && !$('repo-dropdown').contains(e.relatedTarget)) closeRepoMenu();
  });
  loadRepos().catch(() => {}); // prefetch
}

function selectRepo(value) {
  const repo = value.trim().replace(/^\/+|\/+$/g, '');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo) || repo === state.repo) return;
  state.repo = repo;
  state.scope = null;
  state.board = null;
  updateRepoButton();
  loadBoard();
}

// ---------- user menu ----------

function initUserMenu() {
  const btn = $('user-btn');
  const menu = $('user-menu');
  const items = () => [...menu.querySelectorAll('.menu-item')];
  const close = ({ focus = false } = {}) => {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focus) btn.focus();
  };
  const open = (focusIndex = null) => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (focusIndex !== null) items().at(focusIndex)?.focus();
  };

  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowDown' ? 0 : -1);
    }
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') list[(i + 1) % list.length].focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length].focus();
    else if (e.key === 'Escape') close({ focus: true });
    else return;
    e.preventDefault();
  });
  menu.addEventListener('click', (e) => e.target.closest('a.menu-item') && close());
  document.addEventListener('mousedown', (e) => {
    if (!$('user-dropdown').contains(e.target)) close();
  });
  $('user-dropdown').addEventListener('focusout', (e) => {
    if (e.relatedTarget && !$('user-dropdown').contains(e.relatedTarget)) close();
  });
}

// ---------- init ----------

async function init() {
  try {
    state.me = await api('/me');
  } catch {
    return;
  }
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('user-name').textContent = state.me.user.login;
  $('user-avatar').src = state.me.user.avatar;
  const giteaBase = state.me.giteaUrl.replace(/\/+$/, '');
  $('brand').href = giteaBase;
  $('user-profile').href = `${giteaBase}/${encodeURIComponent(state.me.user.login)}`;
  $('user-settings').href = `${giteaBase}/user/settings`;
  initUserMenu();
  $('brand-logo').addEventListener('load', () => ($('brand-logo').hidden = false), { once: true });
  $('brand-logo').src = `${giteaBase}/assets/img/logo.svg`;

  const url = readUrl();
  state.repo = url.repo || storageGet('lastRepo', null);
  state.scope = url.scope;
  initRepoPicker();

  $('scope-select').addEventListener('change', (e) => {
    state.scope = e.target.value;
    storageSet(`scope:${state.repo}`, state.scope);
    writeUrl();
    render();
  });

  $('filter-input').addEventListener('input', (e) => {
    state.filter = e.target.value;
    render();
  });

  $('refresh-btn').addEventListener('click', () => loadBoard());

  $('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.href = '/';
  });

  // Refresh when the user comes back to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.board && Date.now() - state.loadedAt > 30_000) {
      loadBoard({ silent: true });
    }
  });

  await loadBoard();
}

translateDocument();
init();
