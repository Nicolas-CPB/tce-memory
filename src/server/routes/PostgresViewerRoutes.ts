
import express, { Request, Response } from 'express';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';
import type { RouteHandler } from '../../services/server/Server.js';
import type { ServerBetaServiceGraph } from '../runtime/types.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const _dirname = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));

export class PostgresViewerRoutes implements RouteHandler {
  private viewerHtmlPath: string | null = null;
  private viewerDir: string | null = null;

  constructor(private readonly graph: ServerBetaServiceGraph) {
    this.resolvePaths();
  }

  private resolvePaths() {
    const candidates = [
      // From src/server/routes/ -> repo root -> src/ui/viewer
      join(_dirname, '..', '..', '..', 'src', 'ui'),
      // From plugin/scripts/ -> repo root -> plugin/ui
      join(_dirname, '..', '..', 'ui'),
      // From dist/npx-cli/ -> repo root -> ui
      join(_dirname, '..', '..', 'ui'),
      // CWD-relative
      join(process.cwd(), 'src', 'ui'),
      join(process.cwd(), 'plugin', 'ui'),
    ];

    for (const c of candidates) {
      if (existsSync(join(c, 'viewer.html'))) {
        this.viewerDir = c;
        this.viewerHtmlPath = join(c, 'viewer.html');
        break;
      }
    }

    if (this.viewerHtmlPath) {
      logger.info('VIEWER', 'Found viewer assets at', { path: this.viewerDir });
    } else {
      logger.warn('VIEWER', 'Viewer assets not found in candidates', { candidates });
    }
  }

  setupRoutes(app: express.Application): void {
    if (this.viewerDir) {
      // Serve static assets (JS, CSS, fonts, icons)
      app.use('/viewer', express.static(this.viewerDir));
      app.use('/viewer/assets', express.static(join(this.viewerDir, 'assets')));
      
      // Serve the HTML at /viewer (or redirect /viewer/ to /viewer)
      app.get('/viewer', (req, res) => {
        if (!this.viewerHtmlPath) return res.status(404).send('Viewer not found');
        res.sendFile(this.viewerHtmlPath);
      });
    }

    // API endpoints expected by the Viewer UI
    app.get('/api/projects', this.handleGetProjects.bind(this));
    app.get('/api/observations', this.handleGetObservations.bind(this));
    app.get('/api/stats', this.handleGetStats.bind(this));
    app.get('/api/processing-status', this.handleGetProcessingStatus.bind(this));
    app.get('/api/settings', this.handleGetSettings.bind(this));
    app.get('/api/summaries', this.handleGetSummaries.bind(this));
    app.get('/api/prompts', this.handleGetPrompts.bind(this));
    app.get('/api/mcp/status', (req, res) => res.json({ enabled: true }));
    app.get('/api/branch/status', (req, res) => res.json({ branch: 'main', isDetached: false }));

    // Duplicate routes under /viewer/api for relative path compatibility
    app.get('/viewer/api/projects', this.handleGetProjects.bind(this));
    app.get('/viewer/api/observations', this.handleGetObservations.bind(this));
    app.get('/viewer/api/stats', this.handleGetStats.bind(this));
    app.get('/viewer/api/processing-status', this.handleGetProcessingStatus.bind(this));
    app.get('/viewer/api/settings', this.handleGetSettings.bind(this));
    app.get('/viewer/api/summaries', this.handleGetSummaries.bind(this));
    app.get('/viewer/api/prompts', this.handleGetPrompts.bind(this));
    app.get('/viewer/api/mcp/status', (req, res) => res.json({ enabled: true }));
    app.get('/viewer/api/branch/status', (req, res) => res.json({ branch: 'main', isDetached: false }));
    
    // Alias for SSE stream (Viewer expects /stream by default)
    // Actually, ServerBetaService already registers /stream.
    // If the viewer uses a relative path, it will work.
  }

  private async handleGetProjects(req: Request, res: Response) {
    try {
      const result = await this.graph.postgres.pool.query('SELECT id, name FROM projects ORDER BY name ASC');
      const projects = result.rows.map(p => p.name);
      const projectsDetailed = result.rows.map(p => ({ name: p.name, id: p.id }));
      
      res.json({
        projects: projects,
        sources: ['postgres'],
        projectsBySource: { 'postgres': projects }
      });
    } catch (err) {
      logger.error('VIEWER', 'Failed to fetch projects', err as Error);
      res.status(500).json({ error: 'InternalError' });
    }
  }

  private async handleGetObservations(req: Request, res: Response) {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const project = req.query.project as string;

      let query = 'SELECT * FROM observations';
      const params: any[] = [];
      if (project) {
        query += ' WHERE project_id = $1 OR (SELECT name FROM projects WHERE id = project_id) = $1';
        params.push(project);
      }
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await this.graph.postgres.pool.query(query, params);
      const totalResult = await this.graph.postgres.pool.query('SELECT count(*) FROM observations' + (project ? ' WHERE project_id = $1 OR (SELECT name FROM projects WHERE id = project_id) = $1' : ''), project ? [project] : []);

      const observations = result.rows.map(row => ({
        id: row.id,
        memory_session_id: row.server_session_id || '',
        project: row.project_id,
        type: row.kind || 'observation',
        title: row.metadata?.title || null,
        subtitle: row.metadata?.subtitle || null,
        narrative: row.metadata?.narrative || row.content,
        facts: row.metadata?.facts || [],
        concepts: row.metadata?.concepts || [],
        files_read: row.metadata?.files_read || [],
        files_modified: row.metadata?.files_modified || [],
        created_at: row.created_at.toISOString(),
        created_at_epoch: row.created_at.getTime(),
        text: row.content
      }));

      res.json({
        observations,
        total: parseInt(totalResult.rows[0].count),
        offset,
        limit
      });
    } catch (err) {
      logger.error('VIEWER', 'Failed to fetch observations', err as Error);
      res.status(500).json({ error: 'InternalError' });
    }
  }

  private async handleGetStats(req: Request, res: Response) {
    try {
      const obsCount = await this.graph.postgres.pool.query('SELECT count(*) FROM observations');
      const projCount = await this.graph.postgres.pool.query('SELECT count(*) FROM projects');
      
      res.json({
        worker: {
          version: 'server-beta',
          uptime: process.uptime(),
          activeSessions: 0,
          sseClients: 0,
          port: 0
        },
        database: {
          path: 'postgres',
          size: 0,
          observations: parseInt(obsCount.rows[0].count),
          sessions: parseInt(projCount.rows[0].count),
          summaries: 0
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'InternalError' });
    }
  }

  private handleGetProcessingStatus(req: Request, res: Response) {
    res.json({ isProcessing: false, queueDepth: 0 });
  }

  private handleGetSettings(req: Request, res: Response) {
    const settingsPath = paths.settings();
    const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
    res.json(settings);
  }

  private handleGetSummaries(req: Request, res: Response) {
    res.json({ summaries: [], total: 0, offset: 0, limit: 20 });
  }

  private handleGetPrompts(req: Request, res: Response) {
    res.json({ prompts: [], total: 0, offset: 0, limit: 20 });
  }
}
