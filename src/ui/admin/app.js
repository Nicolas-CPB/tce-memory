/* ══════════════════════════════════════════════════════════════════
   Claude Mem — Admin UI  |  Application Logic
   ══════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────
const state = {
  teams: [],
  projects: [],
  currentTab: 'teams',
  mem: {
    offset: 0,
    total: 0,
    items: [],
    query: '',
    projectId: '',
    limit: 50,
  },
  confirmCallback: null,
};

// Link-team mode state
let _linkProjId = null;
let _editMemId = null;

// ── API ────────────────────────────────────────────────────────────
const API = '/memory-ui/api';

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: 'ParseError', message: text }; }
  if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
  return json;
}

// ── Toast ──────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastStack').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toast-out .3s forwards';
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3500);
}

// ── Modal helpers ──────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).showModal(); }
function closeModal(id) { document.getElementById(id).close(); }

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeModal(btn.dataset.close);
  // click outside
  if (e.target.classList.contains('modal')) e.target.close();
});

// ── Tab routing ────────────────────────────────────────────────────
const NAV_TABS = {
  teams:    { title: 'Times',    load: loadTeams },
  projects: { title: 'Projetos', load: loadProjects },
  memories: { title: 'Memórias', load: loadMemories },
};

function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === name);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${name}`);
  });
  document.getElementById('pageTitle').textContent = NAV_TABS[name]?.title ?? name;
  NAV_TABS[name]?.load();
  updateAddBtn(name);
  history.replaceState(null, '', `#${name}`);
}

document.querySelectorAll('.nav-item').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab(a.dataset.tab);
  });
});

function updateAddBtn(tab) {
  const btn = document.getElementById('globalAdd');
  const labels = { teams: 'Novo Time', projects: 'Novo Projeto', memories: 'Nova Memória' };
  btn.lastChild.textContent = ` ${labels[tab] ?? 'Novo'}`;
}

document.getElementById('globalAdd').addEventListener('click', () => {
  if (state.currentTab === 'teams') openTeamModal();
  else if (state.currentTab === 'projects') openProjectModal();
  else openMemoryModal();
});

// ── Menu toggle (mobile) ──────────────────────────────────────────
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ── Confirm dialog ────────────────────────────────────────────────
function confirm_(msg, cb) {
  document.getElementById('confirmMessage').textContent = msg;
  state.confirmCallback = cb;
  openModal('modalConfirm');
}

document.getElementById('confirmOk').addEventListener('click', () => {
  closeModal('modalConfirm');
  state.confirmCallback?.();
  state.confirmCallback = null;
});

// ═════════════════════════════════════════════════════════════════
// TEAMS
// ═════════════════════════════════════════════════════════════════
async function loadTeams() {
  const el = document.getElementById('teamsList');
  el.innerHTML = loadingHtml();
  try {
    const data = await apiFetch(`${API}/teams`);
    state.teams = data.teams ?? [];
    renderTeams();
    updateGlobalCount(state.teams.length, 'time');
  } catch (err) {
    el.innerHTML = errorHtml(err.message);
  }
}

function renderTeams() {
  const q = document.getElementById('teamSearch').value.toLowerCase();
  const list = state.teams.filter(t =>
    !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
  );
  const el = document.getElementById('teamsList');
  if (!list.length) {
    el.innerHTML = emptyHtml('Nenhum time encontrado.');
    return;
  }
  el.innerHTML = list.map(t => `
    <article class="card" data-id="${esc(t.id)}">
      <div class="card-name">${esc(t.name)}</div>
      <div class="card-id">${esc(t.id)}</div>
      <div class="card-meta">
        <span class="chip chip-blue">Time</span>
        ${t.project_count != null ? `<span class="chip chip-gray">${t.project_count} projeto(s)</span>` : ''}
      </div>
      <div class="card-date">Criado em ${fmtDate(t.created_at)}</div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-action="add-project-for-team" data-team-id="${esc(t.id)}" data-team-name="${esc(t.name)}">
          + Projeto
        </button>
        <button class="btn btn-danger btn-sm" data-action="delete-team" data-id="${esc(t.id)}" data-name="${esc(t.name)}">
          Excluir
        </button>
      </div>
    </article>
  `).join('');
}

document.getElementById('teamSearch').addEventListener('input', renderTeams);
document.getElementById('refreshTeams').addEventListener('click', loadTeams);

// Team card actions
document.getElementById('teamsList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'delete-team') {
    confirm_(`Excluir o time "${btn.dataset.name}"? Todos os projetos vinculados serão afetados.`, async () => {
      try {
        await apiFetch(`${API}/teams/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
        toast('Time excluído com sucesso.', 'success');
        loadTeams();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
  if (btn.dataset.action === 'add-project-for-team') {
    openProjectModal(btn.dataset.teamId);
  }
});

// Team modal
function openTeamModal() {
  document.getElementById('teamNameInput').value = '';
  document.getElementById('modalTeamTitle').textContent = 'Novo Time';
  openModal('modalTeam');
  setTimeout(() => document.getElementById('teamNameInput').focus(), 80);
}

document.getElementById('saveTeam').addEventListener('click', async () => {
  const name = document.getElementById('teamNameInput').value.trim();
  if (!name) { toast('Nome é obrigatório.', 'error'); return; }
  try {
    await apiFetch(`${API}/teams`, { method: 'POST', body: JSON.stringify({ name }) });
    toast(`Time "${name}" criado.`, 'success');
    closeModal('modalTeam');
    loadTeams();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('teamNameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('saveTeam').click();
});

// ═════════════════════════════════════════════════════════════════
// PROJECTS
// ═════════════════════════════════════════════════════════════════
async function loadProjects() {
  const el = document.getElementById('projectsList');
  el.innerHTML = loadingHtml();
  try {
    const [pData, tData] = await Promise.all([
      apiFetch(`${API}/projects`),
      apiFetch(`${API}/teams`),
    ]);
    state.projects = pData.projects ?? [];
    state.teams = tData.teams ?? [];
    populateTeamFilter();
    populateProjectTeamSelect();
    renderProjects();
    updateGlobalCount(state.projects.length, 'projeto');
  } catch (err) {
    el.innerHTML = errorHtml(err.message);
  }
}

function populateTeamFilter() {
  const sel = document.getElementById('projectTeamFilter');
  const curr = sel.value;
  sel.innerHTML = '<option value="">Todos os times</option>' +
    state.teams.map(t => `<option value="${esc(t.id)}"${t.id === curr ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
}

function renderProjects() {
  const q    = document.getElementById('projectSearch').value.toLowerCase();
  const team = document.getElementById('projectTeamFilter').value;
  const list = state.projects.filter(p =>
    (!team || p.team_id === team) &&
    (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
  );
  const el = document.getElementById('projectsList');
  if (!list.length) {
    el.innerHTML = emptyHtml('Nenhum projeto encontrado.');
    return;
  }
  const teamMap = Object.fromEntries(state.teams.map(t => [t.id, t.name]));
  el.innerHTML = list.map(p => `
    <article class="card" data-id="${esc(p.id)}">
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-id">${esc(p.id)}</div>
      <div class="card-meta">
        <span class="chip chip-purple">Projeto</span>
        ${p.team_id ? `<span class="chip chip-blue">${esc(teamMap[p.team_id] ?? p.team_id)}</span>` : ''}
      </div>
      <div class="card-date">Criado em ${fmtDate(p.created_at)}</div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-action="link-team" data-proj-id="${esc(p.id)}" data-proj-name="${esc(p.name)}" data-team-id="${esc(p.team_id ?? '')}">
          Vincular Time
        </button>
        <button class="btn btn-danger btn-sm" data-action="delete-project" data-id="${esc(p.id)}" data-name="${esc(p.name)}">
          Excluir
        </button>
      </div>
    </article>
  `).join('');
}

document.getElementById('projectSearch').addEventListener('input', renderProjects);
document.getElementById('projectTeamFilter').addEventListener('change', renderProjects);
document.getElementById('refreshProjects').addEventListener('click', loadProjects);

// Project card actions
document.getElementById('projectsList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'delete-project') {
    confirm_(`Excluir o projeto "${btn.dataset.name}"?`, async () => {
      try {
        await apiFetch(`${API}/projects/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
        toast('Projeto excluído.', 'success');
        loadProjects();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
  if (btn.dataset.action === 'link-team') {
    openLinkTeamModal(btn.dataset.projId, btn.dataset.projName, btn.dataset.teamId);
  }
});

// Project modal
function openProjectModal(preselectedTeamId = '') {
  document.getElementById('projectNameInput').value = '';
  populateProjectTeamSelect(preselectedTeamId);
  document.getElementById('modalProjectTitle').textContent = 'Novo Projeto';
  openModal('modalProject');
  setTimeout(() => document.getElementById('projectNameInput').focus(), 80);
}

function populateProjectTeamSelect(selected = '') {
  const sel = document.getElementById('projectTeamSelect');
  sel.innerHTML = '<option value="">— Selecione um time —</option>' +
    state.teams.map(t =>
      `<option value="${esc(t.id)}"${t.id === selected ? ' selected' : ''}>${esc(t.name)}</option>`
    ).join('');
}

// Link-team inline (reuses project modal as a link dialog)
function openLinkTeamModal(projId, projName, currentTeamId) {
  _linkProjId = projId;
  document.getElementById('projectNameInput').value = projName;
  document.getElementById('projectNameInput').disabled = true;
  populateProjectTeamSelect(currentTeamId);
  document.getElementById('modalProjectTitle').textContent = `Vincular Time → ${projName}`;
  document.getElementById('saveProject').textContent = 'Vincular';

  const modal = document.getElementById('modalProject');
  modal.addEventListener('close', () => {
    document.getElementById('projectNameInput').disabled = false;
    document.getElementById('saveProject').textContent = 'Salvar';
    _linkProjId = null;
  }, { once: true });

  openModal('modalProject');
}

// Project modal single handler — detects link-mode vs. create-mode
document.getElementById('saveProject').addEventListener('click', async () => {
  const teamId = document.getElementById('projectTeamSelect').value;
  if (!teamId) { toast('Selecione um time.', 'error'); return; }

  if (_linkProjId) {
    // Vincular time a projeto existente
    try {
      await apiFetch(`${API}/projects/${encodeURIComponent(_linkProjId)}/link-team`, {
        method: 'POST',
        body: JSON.stringify({ teamId }),
      });
      toast('Projeto vinculado ao time.', 'success');
      closeModal('modalProject');
      loadProjects();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  // Criar novo projeto
  const name = document.getElementById('projectNameInput').value.trim();
  if (!name) { toast('Nome é obrigatório.', 'error'); return; }
  try {
    await apiFetch(`${API}/projects`, { method: 'POST', body: JSON.stringify({ name, teamId }) });
    toast(`Projeto "${name}" criado.`, 'success');
    closeModal('modalProject');
    loadProjects();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ═════════════════════════════════════════════════════════════════
// MEMORIES
// ═════════════════════════════════════════════════════════════════
async function loadMemories(resetOffset = false) {
  if (resetOffset) state.mem.offset = 0;
  const el = document.getElementById('memList');
  el.innerHTML = `<div class="state-loading"><div class="spinner"></div><span>Carregando memórias...</span></div>`;

  try {
    const q       = state.mem.query;
    const projId  = state.mem.projectId;
    const limit   = state.mem.limit;
    const offset  = state.mem.offset;
    const params  = new URLSearchParams({ limit, offset });
    if (q)      params.set('query', q);
    if (projId) params.set('projectId', projId);

    const data = await apiFetch(`${API}/observations?${params}`);
    state.mem.items = data.observations ?? [];
    state.mem.total = data.total ?? 0;
    renderMemories();
    updateGlobalCount(state.mem.total, 'memória');
  } catch (err) {
    el.innerHTML = errorHtml(err.message);
  }
}

function renderMemories() {
  const el = document.getElementById('memList');
  const items = state.mem.items;
  if (!items.length) {
    el.innerHTML = emptyHtml('Nenhuma memória encontrada.');
    document.getElementById('memPagination').innerHTML = '';
    return;
  }
  el.innerHTML = items.map(o => `
    <article class="mem-item" data-id="${esc(o.id)}">
      <div class="mem-header">
        <div class="mem-meta">
          ${o.project_name || o.project_id
            ? `<span class="chip chip-purple">${esc(o.project_name || o.project_id)}</span>`
            : '<span class="chip chip-gray">sem projeto</span>'}
          <span class="chip chip-blue">${esc(o.kind ?? 'manual')}</span>
          <span class="mem-date">${fmtDate(o.created_at)}</span>
          <span class="mem-id">${esc(o.id)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" data-action="edit-mem" data-id="${esc(o.id)}">Editar</button>
          <button class="btn btn-danger btn-sm" data-action="delete-mem" data-id="${esc(o.id)}">Excluir</button>
        </div>
      </div>
      <div class="mem-content" id="mc-${esc(o.id)}">${esc(o.content)}</div>
      <div class="mem-footer">
        <button class="btn-expand" data-expand="${esc(o.id)}">Expandir ▾</button>
      </div>
    </article>
  `).join('');

  renderPagination();
}

function renderPagination() {
  const { offset, limit, total } = state.mem;
  const pages = Math.ceil(total / limit);
  const curr  = Math.floor(offset / limit);
  const pg = document.getElementById('memPagination');
  if (pages <= 1) { pg.innerHTML = ''; return; }

  const maxBtns = 7;
  let start = Math.max(0, curr - Math.floor(maxBtns / 2));
  let end   = Math.min(pages, start + maxBtns);
  start     = Math.max(0, end - maxBtns);

  pg.innerHTML = `
    <button class="page-btn" data-page="${curr - 1}" ${curr === 0 ? 'disabled' : ''}>‹</button>
    ${Array.from({ length: end - start }, (_, i) => start + i).map(p => `
      <button class="page-btn ${p === curr ? 'active' : ''}" data-page="${p}">${p + 1}</button>
    `).join('')}
    <button class="page-btn" data-page="${curr + 1}" ${curr >= pages - 1 ? 'disabled' : ''}>›</button>
  `;
}

document.getElementById('memPagination').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-page]');
  if (!btn || btn.disabled) return;
  const page = parseInt(btn.dataset.page, 10);
  state.mem.offset = page * state.mem.limit;
  loadMemories();
});

// Memory list actions
document.getElementById('memList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  const exp = e.target.closest('[data-expand]');

  if (exp) {
    const id  = exp.dataset.expand;
    const mc  = document.getElementById(`mc-${id}`);
    const expanded = mc.classList.toggle('expanded');
    exp.textContent = expanded ? 'Recolher ▴' : 'Expandir ▾';
    return;
  }

  if (!btn) return;

  if (btn.dataset.action === 'delete-mem') {
    confirm_('Excluir esta memória permanentemente?', async () => {
      try {
        await apiFetch(`${API}/observations/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
        toast('Memória excluída.', 'success');
        loadMemories();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  if (btn.dataset.action === 'edit-mem') {
    const item = state.mem.items.find(o => o.id === btn.dataset.id);
    if (!item) return;
    openMemoryModal(item);
  }
});

// Memory search
document.getElementById('memSearchBtn').addEventListener('click', () => {
  state.mem.query     = document.getElementById('memSearch').value.trim();
  state.mem.projectId = document.getElementById('memProjectFilter').value;
  state.mem.limit     = parseInt(document.getElementById('memLimit').value, 10) || 50;
  loadMemories(true);
});

document.getElementById('memSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('memSearchBtn').click();
});

document.getElementById('memProjectFilter').addEventListener('change', () => {
  state.mem.projectId = document.getElementById('memProjectFilter').value;
  loadMemories(true);
});

document.getElementById('memLimit').addEventListener('change', () => {
  state.mem.limit = parseInt(document.getElementById('memLimit').value, 10) || 50;
  loadMemories(true);
});

document.getElementById('refreshMems').addEventListener('click', () => loadMemories());

// Populate memory project filter
async function populateMemProjectFilter() {
  const sel = document.getElementById('memProjectFilter');
  try {
    const data = await apiFetch(`${API}/projects`);
    state.projects = data.projects ?? [];
    sel.innerHTML = '<option value="">Todos os projetos</option>' +
      state.projects.map(p =>
        `<option value="${esc(p.id)}">${esc(p.name)}</option>`
      ).join('');
  } catch { /* non-critical */ }
}

function openMemoryModal(item = null) {
  _editMemId = item?.id ?? null;
  document.getElementById('modalMemoryTitle').textContent = item ? 'Editar Memória' : 'Nova Memória';
  document.getElementById('memContentInput').value = item?.content ?? '';
  document.getElementById('memKindInput').value = item?.kind ?? 'manual';

  const projField = document.getElementById('memProjectField');
  projField.style.display = item ? 'none' : '';

  // Populate project select
  const sel = document.getElementById('memProjectSelect');
  sel.innerHTML = '<option value="">— Selecione um projeto —</option>' +
    state.projects.map(p =>
      `<option value="${esc(p.id)}"${item?.project_id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`
    ).join('');

  openModal('modalMemory');
  setTimeout(() => document.getElementById('memContentInput').focus(), 80);
}

document.getElementById('saveMemory').addEventListener('click', async () => {
  const content = document.getElementById('memContentInput').value.trim();
  const kind    = document.getElementById('memKindInput').value.trim() || 'manual';

  if (!content) { toast('Conteúdo é obrigatório.', 'error'); return; }

  try {
    if (_editMemId) {
      await apiFetch(`${API}/observations/${encodeURIComponent(_editMemId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ content, kind }),
      });
      toast('Memória atualizada.', 'success');
    } else {
      const projectId = document.getElementById('memProjectSelect').value;
      if (!projectId) { toast('Selecione um projeto.', 'error'); return; }
      await apiFetch(`${API}/observations`, {
        method: 'POST',
        body: JSON.stringify({ content, kind, projectId }),
      });
      toast('Memória criada.', 'success');
    }
    closeModal('modalMemory');
    loadMemories();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ═════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function loadingHtml() {
  return `<div class="state-loading"><div class="spinner"></div><span>Carregando...</span></div>`;
}

function emptyHtml(msg) {
  return `<div class="state-empty">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>${esc(msg)}</span>
  </div>`;
}

function errorHtml(msg) {
  return `<div class="state-error">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <span>Erro: ${esc(msg)}</span>
  </div>`;
}

function updateGlobalCount(n, label) {
  const s = n === 1 ? '' : 's';
  document.getElementById('globalCount').textContent = `${n} ${label}${s}`;
}

// ═════════════════════════════════════════════════════════════════
// BOOT
// ═════════════════════════════════════════════════════════════════
/**
 * Real-time updates via SSE
 */
let sseSource = null;
function bootSSE() {
  if (sseSource) {
    sseSource.close();
  }

  sseSource = new EventSource('/stream');
  
  sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('[SSE] Event received:', data.type, data);
      
      switch (data.type) {
        case 'observation_created':
        case 'observation_updated':
        case 'observation_deleted':
          if (state.currentTab === 'memories') {
            loadMemories();
          }
          break;
        case 'new_project':
        case 'project_deleted':
          if (state.currentTab === 'projects') {
            loadProjects();
          }
          break;
        case 'new_team':
        case 'team_deleted':
          if (state.currentTab === 'teams') {
            loadTeams();
          }
          break;
      }
    } catch (err) {
      console.error('[SSE] Failed to parse event:', err);
    }
  };

  sseSource.onerror = (err) => {
    console.warn('[SSE] Connection error, retrying in 5s...', err);
    sseSource.close();
    setTimeout(bootSSE, 5000);
  };
}

async function boot() {
  // Pre-load projects list for memory filter
  await populateMemProjectFilter();

  // Start real-time updates
  bootSSE();

  // Route from hash
  const hash = location.hash.replace('#', '') || 'teams';
  switchTab(Object.keys(NAV_TABS).includes(hash) ? hash : 'teams');
}

boot();
