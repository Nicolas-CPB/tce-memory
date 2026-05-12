// SPDX-License-Identifier: Apache-2.0

import type { Application } from 'express';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import net from 'net';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { Server, type RouteHandler } from '../../services/server/Server.js';
import { paths } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import {
  captureProcessStartToken,
  verifyPidFileOwnership,
  type PidInfo,
} from '../../supervisor/process-registry.js';
import { ServerV1PostgresRoutes } from '../routes/v1/ServerV1PostgresRoutes.js';
import { SessionsObservationsAdapter } from '../compat/SessionsObservationsAdapter.js';
import { SessionsSummarizeAdapter } from '../compat/SessionsSummarizeAdapter.js';
import { ActiveServerBetaQueueManager } from './ActiveServerBetaQueueManager.js';
import type { ServerBetaServiceGraph, ServerBetaQueueLaneMetric } from './types.js';

const SERVER_BETA_RUNTIME = 'server-beta';
const DEFAULT_SERVER_BETA_HOST = '127.0.0.1';
const DEFAULT_SERVER_BETA_PORT = 37877;

export interface ServerBetaServiceOptions {
  graph: ServerBetaServiceGraph;
  host?: string;
  port?: number;
  persistRuntimeState?: boolean;
}

export interface ServerBetaRuntimeState {
  runtime: typeof SERVER_BETA_RUNTIME;
  pid: number;
  port: number;
  host: string;
  startedAt: string;
  bootstrap: ServerBetaServiceGraph['postgres']['bootstrap'];
  boundaries: {
    queueManager: ReturnType<ServerBetaServiceGraph['queueManager']['getHealth']>;
    generationWorkerManager: ReturnType<ServerBetaServiceGraph['generationWorkerManager']['getHealth']>;
    providerRegistry: ReturnType<ServerBetaServiceGraph['providerRegistry']['getHealth']>;
    eventBroadcaster: ReturnType<ServerBetaServiceGraph['eventBroadcaster']['getHealth']>;
  };
}

class ServerBetaRuntimeInfoRoutes implements RouteHandler {
  constructor(private readonly graph: ServerBetaServiceGraph) {}

  setupRoutes(app: Application): void {
    const pool = this.graph.postgres.pool;
    const uiHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Claude Mem</title><style>:root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#d7dde7;background:#0d1117;color-scheme:dark}body{margin:0;background:#0d1117}.top{height:58px;display:flex;align-items:center;gap:12px;padding:0 18px;border-bottom:1px solid #263241;background:#111722;position:sticky;top:0;z-index:2}.brand{font-weight:760;color:#f3f6fb}.pill{font-size:12px;border:1px solid #334155;border-radius:999px;padding:4px 9px;color:#aab6c7;background:#151e2b}.wrap{max-width:1180px;margin:22px auto;padding:0 16px}.section{margin-bottom:18px}.sectionHead{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}.sectionHead h2{font-size:15px;margin:0;color:#e6edf7}.bar,.projectForm{display:grid;grid-template-columns:1fr 92px 98px;gap:8px;margin-bottom:14px}.projectForm{grid-template-columns:1fr 120px}input,textarea,select,button{font:inherit}input,textarea,select{border:1px solid #334155;border-radius:6px;background:#0f1622;color:#e6ebf2;padding:10px;outline:none}input:focus,textarea:focus,select:focus{border-color:#4f8cff;box-shadow:0 0 0 3px rgba(79,140,255,.16)}button{border:1px solid #39485c;background:#182233;color:#dce4ee;border-radius:6px;padding:9px 12px;cursor:pointer}button:hover{background:#202c3f}button.primary{background:#2563eb;border-color:#3b82f6;color:#fff}button.primary:hover{background:#1d4ed8}button.danger{color:#fecaca;border-color:#7f1d1d;background:#29171a}button.danger:hover{background:#3a1b20}.grid{display:grid;gap:10px}.projects{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}.projectCard,.item{background:#111827;border:1px solid #263241;border-radius:8px;padding:12px}.projectCard .name{font-weight:720;color:#8fd3ff;margin-bottom:6px}.copy{font-family:Consolas,Monaco,monospace;font-size:12px;color:#a8b3c2;word-break:break-all}.meta{display:flex;gap:8px;align-items:center;color:#93a4b8;font-size:12px;flex-wrap:wrap}.kind{font-weight:700;color:#d6e4ff}.project{font-weight:700;color:#8fd3ff;border:1px solid #24445c;background:#102235;border-radius:999px;padding:3px 8px}.id{font-family:Consolas,Monaco,monospace;color:#7f8ea3}.content{white-space:pre-wrap;margin:10px 0;color:#e4e9f1;line-height:1.45}.actions{display:flex;gap:8px}.empty,.err{padding:20px;border:1px dashed #334155;border-radius:8px;color:#9aa8ba;background:#111827}.err{color:#fecaca;border-color:#7f1d1d}dialog{border:1px solid #334155;border-radius:8px;max-width:760px;width:calc(100% - 32px);padding:0;background:#111827;color:#e4e9f1}dialog::backdrop{background:rgba(2,6,23,.72)}.dlg{padding:16px}.dlg h3{margin:0 0 12px}.dlg textarea{width:100%;min-height:220px;box-sizing:border-box}.row{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}@media(max-width:640px){.bar,.projectForm{grid-template-columns:1fr}.top{padding:0 12px}.wrap{margin:14px auto}}</style></head><body><div class="top"><div class="brand">Claude Mem</div><span class="pill" id="count">carregando</span><span class="pill">server-beta</span></div><main class="wrap"><section class="section"><div class="sectionHead"><h2>Projetos</h2><button id="refreshProjects">Atualizar</button></div><form class="projectForm" id="projectForm"><input id="projectName" placeholder="Nome do projeto"><button class="primary">Cadastrar</button></form><div id="projects" class="projects"></div></section><section class="section"><div class="sectionHead"><h2>Memórias</h2></div><form class="bar" id="search"><input id="q" placeholder="Buscar por conteúdo, projeto ou ID"><select id="limit"><option>20</option><option selected>50</option><option>100</option><option>200</option></select><button class="primary">Buscar</button></form><section id="list" class="grid"></section></section></main><dialog id="dlg"><form method="dialog" class="dlg"><h3>Editar memória</h3><textarea id="editContent"></textarea><div class="row"><button value="cancel">Cancelar</button><button id="save" value="default" class="primary">Salvar</button></div></form></dialog><script>const list=document.getElementById('list'),count=document.getElementById('count'),dlg=document.getElementById('dlg'),edit=document.getElementById('editContent'),projectsEl=document.getElementById('projects');let editing=null;function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}function projectLabel(o){return o.project_name||o.project_id||'sem projeto'}async function api(u,o){const r=await fetch(u,{headers:{'Content-Type':'application/json'},...o});if(!r.ok)throw new Error(await r.text());return r.json()}async function loadProjects(){projectsEl.innerHTML='<div class="empty">Carregando projetos...</div>';try{const d=await api('/memory-ui/api/projects');projectsEl.innerHTML=d.projects.length?d.projects.map(p=>'<article class="projectCard"><div class="name">'+esc(p.name)+'</div><div class="copy">'+esc(p.id)+'</div></article>').join(''):'<div class="empty">Nenhum projeto cadastrado.</div>'}catch(e){projectsEl.innerHTML='<div class="err">'+esc(e.message)+'</div>'}}async function load(){list.innerHTML='<div class="empty">Carregando...</div>';try{const q=document.getElementById('q').value,limit=document.getElementById('limit').value;const d=await api('/memory-ui/api/observations?query='+encodeURIComponent(q)+'&limit='+encodeURIComponent(limit));count.textContent=d.total+' memoria'+(d.total===1?'':'s');list.innerHTML=d.observations.length?d.observations.map(o=>'<article class="item"><div class="meta"><span class="project" title="'+esc(o.project_id)+'">'+esc(projectLabel(o))+'</span><span class="kind">'+esc(o.kind)+'</span><span>'+esc(o.created_at)+'</span><span class="id">'+esc(o.id)+'</span></div><div class="content">'+esc(o.content)+'</div><div class="actions"><button data-edit="'+esc(o.id)+'">Editar</button><button class="danger" data-del="'+esc(o.id)+'">Deletar</button></div></article>').join(''):'<div class="empty">Nenhuma memoria encontrada.</div>'}catch(e){list.innerHTML='<div class="err">'+esc(e.message)+'</div>'}}document.getElementById('projectForm').addEventListener('submit',async e=>{e.preventDefault();const name=document.getElementById('projectName').value.trim();if(!name)return;await api('/memory-ui/api/projects',{method:'POST',body:JSON.stringify({name})});document.getElementById('projectName').value='';await loadProjects()});document.getElementById('refreshProjects').addEventListener('click',loadProjects);document.getElementById('search').addEventListener('submit',e=>{e.preventDefault();load()});list.addEventListener('click',async e=>{const ed=e.target.closest('[data-edit]'),del=e.target.closest('[data-del]');if(ed){editing=ed.dataset.edit;edit.value=ed.closest('.item').querySelector('.content').textContent;dlg.showModal()}if(del&&confirm('Deletar esta memoria?')){await api('/memory-ui/api/observations/'+encodeURIComponent(del.dataset.del),{method:'DELETE'});load()}});document.getElementById('save').addEventListener('click',async e=>{e.preventDefault();await api('/memory-ui/api/observations/'+encodeURIComponent(editing),{method:'PATCH',body:JSON.stringify({content:edit.value})});dlg.close();load()});loadProjects();load();</script></body></html>`;

    app.get('/', (req, res) => res.redirect('/memories'));
    app.get('/memories', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(uiHtml);
    });
    app.get('/memory-ui', (req, res) => res.redirect('/memories'));

    app.get('/memory-ui/api/projects', async (req, res) => {
      try {
        const result = await pool.query('SELECT id,team_id,name,metadata,created_at,updated_at FROM projects ORDER BY name ASC');
        res.json({ projects: result.rows });
      } catch (err: unknown) {
        res.status(500).json({ error: 'MemoryUiError', message: err instanceof Error ? err.message : String(err) });
      }
    });

    app.post('/memory-ui/api/projects', async (req, res) => {
      try {
        const name = String(req.body?.name ?? '').trim();
        if (!name) return void res.status(400).json({ error: 'BadRequest', message: 'name is required' });
        const existing = await pool.query('SELECT id,team_id,name,metadata,created_at,updated_at FROM projects WHERE name = $1 LIMIT 1', [name]);
        if (existing.rows[0]) return void res.status(200).json({ project: existing.rows[0], created: false });
        const team = await pool.query('SELECT id FROM teams ORDER BY name ASC LIMIT 1');
        if (!team.rows[0]) return void res.status(500).json({ error: 'MemoryUiError', message: 'No team found' });
        const newId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'proj_' + Date.now() + '_' + Math.random().toString(16).slice(2);
        const result = await pool.query('INSERT INTO projects (id, team_id, name, metadata) VALUES ($1,$2,$3,$4::jsonb) RETURNING id,team_id,name,metadata,created_at,updated_at', [newId, team.rows[0].id, name, '{}']);
        res.status(201).json({ project: result.rows[0], created: true });
      } catch (err: unknown) {
        res.status(500).json({ error: 'MemoryUiError', message: err instanceof Error ? err.message : String(err) });
      }
    });

    app.get('/memory-ui/api/observations', async (req, res) => {
      try {
        const limit = Math.min(Math.max(parseInt(req.query?.limit as string ?? '50', 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query?.offset as string ?? '0', 10) || 0, 0);
        const query = String(req.query?.query ?? '').trim();
        const params: unknown[] = [];
        let where = '';
        if (query) {
          params.push('%' + query + '%');
          where = 'WHERE o.content ILIKE $1 OR o.kind ILIKE $1 OR o.id ILIKE $1 OR o.project_id ILIKE $1 OR p.name ILIKE $1';
        }
        const limitIdx = params.length + 1;
        const offsetIdx = params.length + 2;
        const totalResult = await pool.query(`SELECT count(*)::int AS total FROM observations o LEFT JOIN projects p ON p.id=o.project_id ${where}`, params);
        const result = await pool.query(`SELECT o.id,o.project_id,p.name AS project_name,o.team_id,o.server_session_id,o.kind,o.content,o.metadata,o.created_at,o.updated_at FROM observations o LEFT JOIN projects p ON p.id=o.project_id ${where} ORDER BY o.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`, [...params, limit, offset]);
        res.json({ total: totalResult.rows[0]?.total ?? 0, observations: result.rows });
      } catch (err: unknown) {
        res.status(500).json({ error: 'MemoryUiError', message: err instanceof Error ? err.message : String(err) });
      }
    });

    app.patch('/memory-ui/api/observations/:id', async (req, res) => {
      try {
        const id = String(req.params.id);
        const content = String(req.body?.content ?? '').trim();
        if (!content) return void res.status(400).json({ error: 'BadRequest', message: 'content is required' });
        const result = await pool.query('UPDATE observations SET content = $1, updated_at = now() WHERE id = $2 RETURNING id,project_id,team_id,server_session_id,kind,content,metadata,created_at,updated_at', [content, id]);
        if (!result.rows[0]) return void res.status(404).json({ error: 'NotFound', message: 'Observation not found' });
        res.json({ observation: result.rows[0] });
      } catch (err: unknown) {
        res.status(500).json({ error: 'MemoryUiError', message: err instanceof Error ? err.message : String(err) });
      }
    });

    app.delete('/memory-ui/api/observations/:id', async (req, res) => {
      try {
        const id = String(req.params.id);
        const result = await pool.query('DELETE FROM observations WHERE id = $1 RETURNING id', [id]);
        if (!result.rows[0]) return void res.status(404).json({ error: 'NotFound', message: 'Observation not found' });
        res.json({ deleted: true, id });
      } catch (err: unknown) {
        res.status(500).json({ error: 'MemoryUiError', message: err instanceof Error ? err.message : String(err) });
      }
    });
    app.get('/healthz', (_req, res) => {
      res.json({ status: 'ok', runtime: SERVER_BETA_RUNTIME });
    });

    // Phase 12 — `/v1/info` includes per-lane queue metrics so deploy probes
    // can read waiting/active/completed/failed/delayed/stalled without
    // hitting `/api/health`. Sampling is best-effort: a Redis blip surfaces
    // the lane with `unavailable: true` rather than crashing the route.
    app.get('/v1/info', async (_req, res) => {
      const queueLanes = await collectQueueLaneMetrics(this.graph);
      res.json({
        name: 'claude-mem-server',
        runtime: SERVER_BETA_RUNTIME,
        authMode: this.graph.authMode,
        postgres: {
          initialized: this.graph.postgres.bootstrap.initialized,
          schemaVersion: this.graph.postgres.bootstrap.schemaVersion,
        },
        boundaries: {
          queueManager: this.graph.queueManager.getHealth(),
          generationWorkerManager: this.graph.generationWorkerManager.getHealth(),
          providerRegistry: this.graph.providerRegistry.getHealth(),
          eventBroadcaster: this.graph.eventBroadcaster.getHealth(),
        },
        queueLanes,
      });
    });
  }
}

async function collectQueueLaneMetrics(
  graph: ServerBetaServiceGraph,
): Promise<ServerBetaQueueLaneMetric[]> {
  const manager = graph.queueManager;
  if (!(manager instanceof ActiveServerBetaQueueManager)) {
    return [];
  }
  try {
    return await manager.getLaneMetrics();
  } catch {
    // /api/health and /v1/info MUST never throw on a queue blip — surface
    // empty lanes so the rest of the payload still renders.
    return [];
  }
}

export class ServerBetaService {
  private readonly graph: ServerBetaServiceGraph;
  private readonly host: string;
  private readonly requestedPort: number;
  private boundPort: number | null = null;
  private readonly persistRuntimeState: boolean;
  private server: Server | null = null;
  private stopping = false;

  constructor(options: ServerBetaServiceOptions) {
    this.graph = options.graph;
    this.host = options.host ?? process.env.CLAUDE_MEM_SERVER_HOST ?? DEFAULT_SERVER_BETA_HOST;
    this.requestedPort = options.port ?? getServerBetaPort();
    this.persistRuntimeState = options.persistRuntimeState ?? true;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = new Server({
      getInitializationComplete: () => this.graph.postgres.bootstrap.initialized,
      getMcpReady: () => true,
      onShutdown: () => this.stop(),
      onRestart: async () => {
        await this.stop();
        await this.start();
      },
      workerPath: '',
      runtime: SERVER_BETA_RUNTIME,
      getAiStatus: () => ({
        provider: 'disabled',
        authMethod: this.graph.authMode,
        lastInteraction: null,
      }),
      // Phase 10 — surface BullMQ/Valkey health on /api/health so deploy
      // probes (and the Docker E2E) can confirm the queue engine without
      // peeking at /v1/info. The queue manager's getHealth() returns its
      // boundary descriptor; we shape it into the worker-compatible
      // ObservationQueueHealth schema the Server class expects.
      // Phase 12 — also include per-lane counts (waiting/active/completed/
      // failed/delayed/stalled) so deploy probes can monitor saturation.
      getQueueHealth: async () => {
        const health = this.graph.queueManager.getHealth();
        const details = (health.details ?? {}) as Record<string, unknown>;
        if (health.status !== 'active' || details.engine !== 'bullmq') {
          return null;
        }
        const lanes = await collectQueueLaneMetrics(this.graph);
        return {
          engine: 'bullmq' as const,
          redis: {
            status: 'ok' as const,
            mode: String(details.mode ?? 'unknown'),
            host: String(details.host ?? '127.0.0.1'),
            port: typeof details.port === 'number' ? details.port : 6379,
            prefix: String(details.prefix ?? 'claude_mem'),
          },
          lanes: lanes.map(lane => ({
            kind: lane.kind,
            name: lane.name,
            waiting: lane.waiting,
            active: lane.active,
            completed: lane.completed,
            failed: lane.failed,
            delayed: lane.delayed,
            stalled: lane.stalled,
            unavailable: lane.unavailable,
            ...(lane.unavailableReason ? { unavailableReason: lane.unavailableReason } : {}),
          })),
        };
      },
    });
    server.registerRoutes(new ServerBetaRuntimeInfoRoutes(this.graph));
    const v1Routes = new ServerV1PostgresRoutes({
      pool: this.graph.postgres.pool,
      queueManager: this.graph.queueManager,
      authMode: this.graph.authMode === 'disabled' ? 'api-key' : this.graph.authMode,
      runtime: SERVER_BETA_RUNTIME,
      // Session policy is read inside the routes (default 'per-event' from
      // resolveSessionGenerationPolicy(), env-overridable via
      // CLAUDE_MEM_SERVER_SESSION_POLICY). We do not duplicate it here.
    });
    server.registerRoutes(v1Routes);

    // Phase 9 — legacy compatibility adapters. These translate the old
    // `/api/sessions/observations` and `/api/sessions/summarize` worker
    // routes to the canonical Server beta event/job model. They share the
    // SAME shared services with /v1/* routes — never duplicate ingest or
    // session-end logic. New clients should hit /v1/* directly.
    const compatAuthMode = this.graph.authMode === 'disabled' ? 'api-key' : this.graph.authMode;
    server.registerRoutes(new SessionsObservationsAdapter({
      pool: this.graph.postgres.pool,
      ingestEvents: v1Routes.getIngestEventsService(),
      authMode: compatAuthMode,
    }));
    server.registerRoutes(new SessionsSummarizeAdapter({
      pool: this.graph.postgres.pool,
      endSession: v1Routes.getEndSessionService(),
      authMode: compatAuthMode,
    }));

    server.finalizeRoutes();

    await server.listen(this.requestedPort, this.host);
    this.server = server;
    this.boundPort = resolveBoundPort(server) ?? this.requestedPort;
    if (this.persistRuntimeState) {
      writeServerBetaState(this.runtimeState());
    }
    logger.info('SYSTEM', 'Server beta started', { host: this.host, port: this.boundPort, pid: process.pid });
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    try {
      if (this.server) {
        try {
          await this.server.close();
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException)?.code !== 'ERR_SERVER_NOT_RUNNING') {
            throw error;
          }
        }
        this.server = null;
      }
      await Promise.all([
        this.graph.queueManager.close(),
        this.graph.generationWorkerManager.close(),
        this.graph.providerRegistry.close(),
        this.graph.eventBroadcaster.close(),
      ]);
      await this.graph.postgres.pool.end();
    } finally {
      if (this.persistRuntimeState) {
        removeServerBetaState();
      }
      this.boundPort = null;
      this.stopping = false;
      logger.info('SYSTEM', 'Server beta stopped');
    }
  }

  getRuntimeState(): ServerBetaRuntimeState {
    return this.runtimeState();
  }

  private runtimeState(): ServerBetaRuntimeState {
    return {
      runtime: SERVER_BETA_RUNTIME,
      pid: process.pid,
      port: this.boundPort ?? this.requestedPort,
      host: this.host,
      startedAt: new Date().toISOString(),
      bootstrap: this.graph.postgres.bootstrap,
      boundaries: {
        queueManager: this.graph.queueManager.getHealth(),
        generationWorkerManager: this.graph.generationWorkerManager.getHealth(),
        providerRegistry: this.graph.providerRegistry.getHealth(),
        eventBroadcaster: this.graph.eventBroadcaster.getHealth(),
      },
    };
  }
}

function resolveBoundPort(server: Server): number | null {
  const address = server.getHttpServer()?.address();
  return address && typeof address !== 'string' ? address.port : null;
}

export async function runServerBetaCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0] ?? '--daemon';
  const port = getServerBetaPort();
  const host = process.env.CLAUDE_MEM_SERVER_HOST ?? DEFAULT_SERVER_BETA_HOST;

  // Phase 10: `claude-mem server worker [start|--daemon]` runs the BullMQ
  // generation worker as a foregrounded process — no HTTP server, no route
  // registration. In Compose this becomes a separately scaled service.
  if (command === 'worker') {
    const sub = (argv[1] ?? '--daemon').toLowerCase();
    if (sub === 'start' || sub === '--daemon' || sub === 'run') {
      await runServerBetaGenerationWorker();
      return;
    }
    console.error('Usage: server-beta-service worker start');
    process.exit(1);
  }

  // `server api-key create|list|revoke` mirrors the worker-service tooling
  // but writes to the Postgres `api_keys` table the server-beta runtime
  // actually reads from. The legacy worker-service CLI talks to SQLite and
  // would be invisible to this stack.
  if (command === 'server' && argv[1]?.toLowerCase() === 'api-key') {
    await runServerBetaApiKeyCli(argv.slice(2));
    return;
  }

  switch (command) {
    case 'start': {
      const existing = readServerBetaPidFile();
      if (verifyPidFileOwnership(existing)) {
        console.log(JSON.stringify({ status: 'ready', runtime: SERVER_BETA_RUNTIME, pid: existing.pid, port: existing.port }));
        return;
      }
      const daemonPid = spawnServerBetaDaemon(port);
      if (daemonPid === undefined) {
        console.error('Failed to spawn server beta daemon.');
        process.exit(1);
      }
      console.log(JSON.stringify({ status: 'starting', runtime: SERVER_BETA_RUNTIME, pid: daemonPid, port }));
      return;
    }

    case 'stop': {
      const existing = readServerBetaPidFile();
      if (!verifyPidFileOwnership(existing)) {
        removeServerBetaState();
        console.log('Server beta is not running');
        return;
      }
      process.kill(existing.pid, 'SIGTERM');
      await waitForPidExit(existing.pid, 5000);
      removeServerBetaState();
      console.log('Server beta stopped');
      return;
    }

    case 'restart': {
      await runServerBetaCli(['stop']);
      await runServerBetaCli(['start']);
      return;
    }

    case 'status': {
      const state = readServerBetaRuntimeState();
      const pidInfo = readServerBetaPidFile();
      if (state && verifyPidFileOwnership(pidInfo)) {
        console.log('Server beta is running');
        console.log(`  PID: ${state.pid}`);
        console.log(`  Port: ${state.port}`);
        console.log(`  Runtime: ${state.runtime}`);
        console.log(`  Started: ${state.startedAt}`);
      } else {
        console.log('Server beta is not running');
      }
      return;
    }

    case '--daemon': {
      const existing = readServerBetaPidFile();
      if (verifyPidFileOwnership(existing) || await isPortInUse(port, host)) {
        process.exit(0);
      }
      const { createServerBetaService } = await import('./create-server-beta-service.js');
      const service = await createServerBetaService();
      const shutdown = async () => {
        await service.stop();
        process.exit(0);
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
      await service.start();
      return;
    }

    default:
      console.error('Usage: server-beta-service start|stop|restart|status');
      process.exit(1);
  }
}

// Phase 10 — Postgres-backed `server api-key create|list|revoke` CLI. The
// legacy `worker-service.cjs server api-key` command talks to SQLite and
// is invisible to the server-beta runtime, which reads keys from
// Postgres. Use this entrypoint inside Docker / Compose.
export async function runServerBetaApiKeyCli(argv: string[]): Promise<void> {
  const sub = argv[0]?.toLowerCase();
  const options = parseFlagArgs(argv.slice(1));

  if (!process.env.CLAUDE_MEM_SERVER_DATABASE_URL) {
    console.error('CLAUDE_MEM_SERVER_DATABASE_URL is required for `server api-key` commands.');
    process.exit(1);
  }

  const { getSharedPostgresPool } = await import('../../storage/postgres/index.js');
  const { PostgresAuthRepository } = await import('../../storage/postgres/auth.js');
  const { createHash, randomBytes } = await import('crypto');
  const pool = getSharedPostgresPool({ requireDatabaseUrl: true });
  const repo = new PostgresAuthRepository(pool);

  try {
    if (sub === 'create') {
      const scopes = (options.scope ?? options.scopes ?? 'memories:read')
        .split(',')
        .map((scope: string) => scope.trim())
        .filter(Boolean);
      // Resolve team/project. If the caller passed --team/--project, honor
      // them. Otherwise, run the server-beta bootstrap to get-or-create the
      // local team+project, then create a NEW key against those IDs with
      // the caller's requested scopes (the bootstrap key uses hook scopes,
      // which is the wrong default for an arbitrary CLI-issued key).
      let teamId = options.team ?? null;
      let projectId = options.project ?? null;
      if (!teamId || !projectId) {
        const { bootstrapServerBetaApiKey } = await import('../../services/hooks/server-beta-bootstrap.js');
        const result = await bootstrapServerBetaApiKey({ pool, closePool: false });
        teamId = result.teamId;
        projectId = result.projectId;
      }
      const rawKey = `cmem_${randomBytes(24).toString('hex')}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const created = await repo.createApiKey({
        keyHash,
        teamId,
        projectId,
        scopes,
        actorId: 'system:server-beta-cli',
      });
      console.log(JSON.stringify({
        id: created.id,
        key: rawKey,
        name: options.name ?? 'server-api-key',
        teamId,
        projectId,
        scopes,
      }, null, 2));
      return;
    }

    if (sub === 'list') {
      // Bound the result set to prevent unintentional cross-tenant key
      // metadata disclosure when an admin runs `api-key list` on a shared
      // host. Default page is 100; --team filters to a single tenant.
      const teamFilter = options.team ?? null;
      const limitArg = Number.parseInt(options.limit ?? '100', 10);
      const offsetArg = Number.parseInt(options.offset ?? '0', 10);
      const limit = Number.isFinite(limitArg) && limitArg > 0 && limitArg <= 500
        ? limitArg
        : 100;
      const offset = Number.isFinite(offsetArg) && offsetArg >= 0 ? offsetArg : 0;
      const where = teamFilter ? 'WHERE team_id = $1' : '';
      const params: unknown[] = teamFilter ? [teamFilter, limit, offset] : [limit, offset];
      const limitIdx = teamFilter ? 2 : 1;
      const offsetIdx = teamFilter ? 3 : 2;
      const result = await pool.query<{
        id: string;
        team_id: string | null;
        project_id: string | null;
        scopes: unknown;
        revoked_at: Date | null;
        expires_at: Date | null;
        last_used_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, team_id, project_id, scopes, revoked_at, expires_at, last_used_at, created_at
         FROM api_keys
         ${where}
         ORDER BY created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );
      console.log(JSON.stringify({
        teamId: teamFilter,
        limit,
        offset,
        count: result.rows.length,
        keys: result.rows.map(row => ({
          id: row.id,
          teamId: row.team_id,
          projectId: row.project_id,
          scopes: row.scopes,
          status: row.revoked_at ? 'revoked' : 'active',
          lastUsedAt: row.last_used_at?.toISOString() ?? null,
          expiresAt: row.expires_at?.toISOString() ?? null,
          createdAt: row.created_at.toISOString(),
        })),
      }, null, 2));
      return;
    }

    if (sub === 'revoke') {
      const id = argv[1];
      if (!id) {
        console.error('Usage: server-beta-service server api-key revoke <id>');
        process.exit(1);
      }
      const result = await pool.query(
        `UPDATE api_keys SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [id],
      );
      if (result.rowCount === 0) {
        console.error(`API key not found or already revoked: ${id}`);
        process.exit(1);
      }
      console.log(JSON.stringify({ id, status: 'revoked' }, null, 2));
      return;
    }

    console.error(`Unknown server api-key subcommand: ${sub ?? '(none)'}`);
    console.error('Usage: server-beta-service server api-key create|list|revoke');
    process.exit(1);
  } finally {
    // Pool is shared; do not close here. The process will exit and the
    // pool tears down via the shared module's process exit hook.
  }
}

function parseFlagArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const equalsIdx = arg.indexOf('=');
      if (equalsIdx > -1) {
        out[arg.slice(2, equalsIdx)] = arg.slice(equalsIdx + 1);
      } else {
        out[arg.slice(2)] = argv[i + 1] ?? '';
        i += 1;
      }
    }
  }
  return out;
}

// Phase 10 — generation-worker-only entrypoint. Starts BullMQ workers against
// the same Postgres + Valkey/Redis the HTTP server-beta service uses, but
// never opens an HTTP listener. In Compose this is a separate, horizontally
// scalable service. The HTTP server-beta service should run with
// CLAUDE_MEM_GENERATION_DISABLED=true so generation only happens in this
// process.
export async function runServerBetaGenerationWorker(): Promise<void> {
  const { validateServerBetaEnv, createServerBetaService } = await import('./create-server-beta-service.js');
  validateServerBetaEnv();
  // Build the service WITHOUT starting HTTP. We reuse createServerBetaService
  // for pool + bootstrap + queue + generation worker wiring, but never call
  // service.start(). Generation is enabled here even if env says
  // CLAUDE_MEM_GENERATION_DISABLED, because this IS the generation worker.
  delete process.env.CLAUDE_MEM_GENERATION_DISABLED;
  const service = await createServerBetaService();
  const state = service.getRuntimeState();
  logger.info('SYSTEM', 'Server beta generation worker started (no HTTP)', {
    pid: process.pid,
    queue: state.boundaries.queueManager,
    generation: state.boundaries.generationWorkerManager,
  });
  console.log(JSON.stringify({ status: 'worker-running', runtime: SERVER_BETA_RUNTIME, pid: process.pid }));

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await service.stop();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // Block forever — Workers run in background via BullMQ. Without this the
  // process would exit and BullMQ jobs would never be consumed.
  await new Promise<void>(() => {});
}

function getServerBetaPort(): number {
  const parsed = Number.parseInt(process.env.CLAUDE_MEM_SERVER_PORT ?? '', 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  // UID-derived default for multi-account isolation: two users on the same
  // host get distinct ports without explicit configuration. Containerized
  // deployments always pass CLAUDE_MEM_SERVER_PORT so this branch is local-only.
  return DEFAULT_SERVER_BETA_PORT + ((process.getuid?.() ?? 77) % 100);
}

function spawnServerBetaDaemon(port: number): number | undefined {
  const scriptPath = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [scriptPath, '--daemon'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CLAUDE_MEM_SERVER_PORT: String(port),
    },
  });
  child.unref();
  return child.pid;
}

function writeServerBetaState(state: ServerBetaRuntimeState): void {
  mkdirSync(dirname(paths.serverBetaRuntime()), { recursive: true });
  const pidInfo: PidInfo = {
    pid: state.pid,
    port: state.port,
    startedAt: state.startedAt,
    startToken: captureProcessStartToken(state.pid) ?? undefined,
  };
  writeFileSync(paths.serverBetaPid(), JSON.stringify(pidInfo, null, 2));
  writeFileSync(paths.serverBetaPort(), `${state.port}\n`);
  writeFileSync(paths.serverBetaRuntime(), JSON.stringify(state, null, 2));
}

function readServerBetaPidFile(): PidInfo | null {
  if (!existsSync(paths.serverBetaPid())) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(paths.serverBetaPid(), 'utf-8')) as PidInfo;
  } catch {
    return null;
  }
}

function readServerBetaRuntimeState(): ServerBetaRuntimeState | null {
  if (!existsSync(paths.serverBetaRuntime())) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(paths.serverBetaRuntime(), 'utf-8')) as ServerBetaRuntimeState;
  } catch {
    return null;
  }
}

function removeServerBetaState(): void {
  rmSync(paths.serverBetaPid(), { force: true });
  rmSync(paths.serverBetaPort(), { force: true });
  rmSync(paths.serverBetaRuntime(), { force: true });
}

async function isPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!verifyPidFileOwnership({ pid, port: 0, startedAt: '' })) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

if (process.argv[1]?.endsWith('ServerBetaService.ts') || process.argv[1]?.endsWith('server-beta-service.cjs')) {
  runServerBetaCli().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
