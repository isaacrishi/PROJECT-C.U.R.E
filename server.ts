import 'dotenv/config';
import http from 'node:http';
import express, { type Request, type Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  db,
  DB_PATH,
  initDatabase,
  newId,
  UPLOAD_DIR,
  writeAuditLog,
} from './server/db.js';
import {
  extractUserFromTokenOrCookie,
  hasProjectAccess,
  optionalAuth,
  requireAuth,
  SESSION_COOKIE_NAME,
  signSessionToken,
  type AuthUser,
  type CureRole,
} from './server/auth.js';
import {
  probeLiteratureApis,
  searchIntegratedLiterature,
} from './server/services/literature.js';
import {
  lookupPharmacologyTargets,
  queryLivePathwaysEnrichrReactome,
  queryOmicsMutationLandscape,
} from './server/services/bioConnectors.js';
import {
  computeCorrelationMatrix,
  computeDifferentialExpression,
  computeKaplanMeier,
  computePathwayEnrichment,
  generateExplicitSyntheticDemoCsv,
  parseDatasetContent,
} from './server/services/analytics.js';
import {
  analyzeLiteratureCorpus,
  evaluateResearchOutput,
  getGeminiClient,
  runStructuredResearchInvestigation,
} from './server/services/gemini.js';
import {
  getActiveModelVersion,
  runAndPersistSimulation,
} from './server/services/simulationEngine.js';
import { runAutonomousResearchCycle } from './server/services/autonomousEngine.js';
import type { DosingSchedule, TreatmentMechanism } from './src/types.js';

initDatabase();

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.set('trust proxy', 1);

function isSecureRequest(req: Request): boolean {
  return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Live multi-investigator WebSocket presence & event rooms keyed by projectId
const projectRooms = new Map<string, Map<WebSocket, AuthUser>>();

function getRoomUsersPayload(projectId: string) {
  const room = projectRooms.get(projectId);
  if (!room) return [];
  const byUserId = new Map<string, { id: string; name: string; role: string; title: string }>();
  for (const u of room.values()) {
    byUserId.set(u.id, { id: u.id, name: u.name, role: u.role, title: u.title });
  }
  return Array.from(byUserId.values());
}

function broadcastToProjectRoom(projectId: string, payload: Record<string, unknown>) {
  const room = projectRooms.get(projectId);
  if (!room) return;
  const serialized = JSON.stringify(payload);
  for (const ws of room.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function writeSseEvent(res: Response, event: string, data: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.use(express.json({ limit: '15mb' }));
app.use(optionalAuth);

// Public unauthenticated liveness/readiness endpoint for standalone load balancers & containers
app.get('/api/health', (_req: Request, res: Response) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      service: 'Project C.U.R.E.',
      database: 'online',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      database: 'error',
      error: err instanceof Error ? err.message : 'Database check failed',
    });
  }
});

// Secure Multer storage for datasets and pathology images
const datasetUpload = multer({
  dest: path.join(UPLOAD_DIR, 'datasets'),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.csv', '.tsv', '.txt', '.json', '.vcf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Unsupported dataset format. Allowed: CSV, TSV, JSON, VCF.'));
  },
});

const pathologyUpload = multer({
  dest: path.join(UPLOAD_DIR, 'pathology'),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/tiff'];
    if (allowedMime.includes(file.mimetype.toLowerCase())) cb(null, true);
    else cb(new Error('Unsupported image format. Allowed: PNG, JPEG, TIFF.'));
  },
});

function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

function listAccessibleProjectIds(user: Request['user']): string[] {
  if (!user) {
    return (
      db.prepare("SELECT id FROM research_projects WHERE visibility = 'public_read'").all() as Array<{ id: string }>
    ).map((r) => r.id);
  }
  if (user.role === 'administrator') {
    return (db.prepare('SELECT id FROM research_projects').all() as Array<{ id: string }>).map((r) => r.id);
  }
  const rows = db
    .prepare(
      `SELECT DISTINCT p.id FROM research_projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id
       WHERE p.owner_id = ?
          OR pm.user_id = ?
          OR (p.visibility = 'organisation' AND p.org_id = ?)
          OR p.visibility = 'public_read'`
    )
    .all(user.id, user.id, user.org_id) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

// ==========================================
// 1. AUTHENTICATION & RESEARCHER ACCOUNTS
// ==========================================
app.get('/api/auth/me', (req: Request, res: Response) => {
  res.json({ user: req.user ?? null });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const row = db
    .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
    .get(String(email).trim()) as
    | {
        id: string;
        org_id: string | null;
        email: string;
        name: string;
        password_hash: string;
        role: CureRole;
        title: string;
        institution: string;
      }
    | undefined;

  if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
    return res.status(401).json({ error: 'Invalid researcher credentials.' });
  }

  const token = signSessionToken(row.id);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  writeAuditLog({
    userId: row.id,
    action: 'user_login',
    entityType: 'user',
    entityId: row.id,
    ipAddress: req.ip,
  });

  res.json({
    token,
    user: {
      id: row.id,
      org_id: row.org_id,
      email: row.email,
      name: row.name,
      role: row.role,
      title: row.title,
      institution: row.institution,
    },
  });
});

app.post('/api/auth/register', (req: Request, res: Response) => {
  const { email, name, password, title, institution, role } = req.body ?? {};
  if (!email || !name || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'Name, valid email, and password (>= 6 characters) are required.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(String(email).trim());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  const allowedSelfRoles: CureRole[] = ['researcher', 'reviewer', 'principal_investigator', 'read_only'];
  const assignedRole: CureRole = allowedSelfRoles.includes(role) ? role : 'researcher';
  const id = newId('usr');
  const hash = bcrypt.hashSync(String(password), 10);

  db.prepare(
    'INSERT INTO users (id, org_id, email, name, password_hash, role, title, institution) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    'org_cure_default',
    String(email).trim().toLowerCase(),
    String(name).trim(),
    hash,
    assignedRole,
    String(title || 'Biomedical Researcher').trim(),
    String(institution || 'CURE Research Consortium').trim()
  );

  const token = signSessionToken(id);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  writeAuditLog({
    userId: id,
    action: 'user_registered',
    entityType: 'user',
    entityId: id,
    ipAddress: req.ip,
  });

  res.status(201).json({
    token,
    user: {
      id,
      org_id: 'org_cure_default',
      email: String(email).trim().toLowerCase(),
      name: String(name).trim(),
      role: assignedRole,
      title: String(title || 'Biomedical Researcher').trim(),
      institution: String(institution || 'CURE Research Consortium').trim(),
    },
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  if (req.user) {
    writeAuditLog({
      userId: req.user.id,
      action: 'user_logout',
      entityType: 'user',
      entityId: req.user.id,
      ipAddress: req.ip,
    });
  }
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
  });
  res.json({ ok: true });
});

// ==========================================
// 2. COMMAND CENTRE DASHBOARD (100% DB-DERIVED)
// ==========================================
app.get('/api/dashboard', (req: Request, res: Response) => {
  const accessibleIds = listAccessibleProjectIds(req.user);
  const idPlaceholders = accessibleIds.map(() => '?').join(',');
  const projectFilter = accessibleIds.length
    ? `(project_id IN (${idPlaceholders}) OR (project_id IS NULL AND user_id = ?))`
    : req.user
    ? `(project_id IS NULL AND user_id = ?)`
    : `1 = 0`;
  const filterArgs = accessibleIds.length
    ? [...accessibleIds, req.user?.id ?? '']
    : req.user
    ? [req.user.id]
    : [];

  const totalProjects = accessibleIds.length;
  const activeInvestigations = req.user
    ? (
        db
          .prepare(`SELECT COUNT(*) as c FROM research_conversations WHERE ${projectFilter}`)
          .get(...filterArgs) as { c: number }
      ).c
    : 0;
  const literatureIndexed = req.user
    ? (
        db
          .prepare(`SELECT COUNT(*) as c FROM literature_sources WHERE ${projectFilter}`)
          .get(...filterArgs) as { c: number }
      ).c
    : 0;
  const datasetsImported = req.user
    ? (
        db
          .prepare(`SELECT COUNT(*) as c FROM research_datasets WHERE ${projectFilter}`)
          .get(...filterArgs) as { c: number }
      ).c
    : 0;
  const hypothesesGenerated = req.user
    ? (
        db
          .prepare(`SELECT COUNT(*) as c FROM research_hypotheses WHERE ${projectFilter}`)
          .get(...filterArgs) as { c: number }
      ).c
    : 0;
  const hypothesesUnderEvaluation = req.user
    ? (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM research_hypotheses WHERE ${projectFilter} AND status IN ('under_review','evidence_gathering','computationally_evaluated','experimentally_proposed','experimentally_tested')`
          )
          .get(...filterArgs) as { c: number }
      ).c
    : 0;
  const experimentsDocumented = req.user
    ? (
        db
          .prepare(`SELECT COUNT(*) as c FROM experiment_plans WHERE ${projectFilter}`)
          .get(...filterArgs) as { c: number }
      ).c
    : 0;
  const validatedFindings = req.user
    ? (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM research_findings WHERE ${projectFilter} AND finding_type = 'experimentally_validated'`
          )
          .get(...filterArgs) as { c: number }
      ).c
    : 0;

  const recentActivity = req.user
    ? db
        .prepare(
          `SELECT a.*, u.name as actor_name FROM audit_logs a
           LEFT JOIN users u ON u.id = a.user_id
           WHERE a.user_id = ? OR a.project_id IN (${idPlaceholders || "''"})
           ORDER BY a.created_at DESC LIMIT 12`
        )
        .all(req.user.id, ...accessibleIds)
    : [];

  const activeCancerTypes = accessibleIds.length
    ? db
        .prepare(
          `SELECT cancer_area, COUNT(*) as count FROM research_projects WHERE id IN (${idPlaceholders}) GROUP BY cancer_area ORDER BY count DESC`
        )
        .all(...accessibleIds)
    : [];

  const recentInvestigations = req.user
    ? db
        .prepare(
          `SELECT id, title, cancer_type, project_id, updated_at FROM research_conversations WHERE ${projectFilter} ORDER BY updated_at DESC LIMIT 5`
        )
        .all(...filterArgs)
    : [];

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  const runningJobs = (
    db.prepare("SELECT COUNT(*) as c FROM analysis_jobs WHERE status IN ('queued','running')").get() as { c: number }
  ).c;

  const simulationsExecuted = req.user
    ? (
        db
          .prepare(`SELECT COUNT(*) as c FROM simulation_runs WHERE ${projectFilter}`)
          .get(...filterArgs) as { c: number }
      ).c
    : 0;
  const autonomousIterations = req.user
    ? (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM autonomous_iterations ai
             JOIN autonomous_cycles ac ON ac.id = ai.cycle_id
             WHERE ${projectFilter.replace(/project_id/g, 'ac.project_id').replace(/user_id/g, 'ac.user_id')}`
          )
          .get(...filterArgs) as { c: number }
      ).c
    : 0;
  const pendingPhysicianReviews = req.user
    ? (
        db
          .prepare("SELECT COUNT(*) as c FROM physician_validation_queue WHERE validation_status = 'pending_physician_review'")
          .get() as { c: number }
      ).c
    : 0;

  res.json({
    overview: {
      totalProjects,
      activeInvestigations,
      literatureIndexed,
      datasetsImported,
      hypothesesGenerated,
      hypothesesUnderEvaluation,
      experimentsDocumented,
      validatedFindings,
      simulationsExecuted,
      autonomousIterations,
      pendingPhysicianReviews,
    },
    recentActivity,
    recentInvestigations,
    intelligenceSummary: {
      activeCancerTypes,
      knowledgeGapsCount: req.user
        ? (
            db
              .prepare(
                `SELECT COUNT(*) as c FROM research_hypotheses WHERE ${projectFilter} AND status IN ('generated','inconclusive')`
              )
              .get(...filterArgs) as { c: number }
          ).c
        : 0,
    },
    systemStatus: {
      geminiApi: geminiConfigured ? 'configured' : 'missing_key',
      geminiModel: getSetting('gemini_model', 'gemini-4-hydrogen'),
      database: 'sqlite_wal_online',
      fileStorage: fs.existsSync(UPLOAD_DIR) ? 'online' : 'unavailable',
      runningJobs,
      confidenceThreshold: Math.max(
        0.9,
        Math.min(0.99, Number(getSetting('physician_review_confidence_threshold', '0.95')) || 0.95)
      ),
      maxIterationsCap: Math.max(1, Math.min(10, Number(getSetting('autonomous_max_iterations_cap', '6')) || 6)),
    },
  });
});

// ==========================================
// 3. RESEARCH PROJECTS (RBAC PROTECTED)
// ==========================================
app.get('/api/projects', (req: Request, res: Response) => {
  const ids = listAccessibleProjectIds(req.user);
  if (ids.length === 0) return res.json({ projects: [] });
  const placeholders = ids.map(() => '?').join(',');
  const projects = db
    .prepare(
      `SELECT p.*, u.name as owner_name,
        (SELECT COUNT(*) FROM literature_sources l WHERE l.project_id = p.id) as literature_count,
        (SELECT COUNT(*) FROM research_datasets d WHERE d.project_id = p.id) as dataset_count,
        (SELECT COUNT(*) FROM research_hypotheses h WHERE h.project_id = p.id) as hypothesis_count,
        (SELECT COUNT(*) FROM experiment_plans e WHERE e.project_id = p.id) as experiment_count,
        (SELECT COUNT(*) FROM pathology_images pi WHERE pi.project_id = p.id) as pathology_count
       FROM research_projects p
       JOIN users u ON u.id = p.owner_id
       WHERE p.id IN (${placeholders})
       ORDER BY p.updated_at DESC`
    )
    .all(...ids);
  res.json({ projects });
});

app.post('/api/projects', requireAuth, (req: Request, res: Response) => {
  const { name, description, cancer_area, primary_objective, research_questions, visibility } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Project name is required.' });
  }
  const id = newId('prj');
  const vis = ['restricted', 'organisation', 'public_read'].includes(visibility) ? visibility : 'restricted';

  db.prepare(
    `INSERT INTO research_projects (id, org_id, owner_id, name, description, cancer_area, primary_objective, research_questions_json, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user!.org_id,
    req.user!.id,
    String(name).trim(),
    String(description || '').trim(),
    String(cancer_area || 'General Oncology').trim(),
    String(primary_objective || '').trim(),
    JSON.stringify(Array.isArray(research_questions) ? research_questions : []),
    vis
  );

  db.prepare(
    'INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)'
  ).run(newId('pm'), id, req.user!.id, 'principal_investigator');

  writeAuditLog({
    userId: req.user!.id,
    projectId: id,
    action: 'project_created',
    entityType: 'research_project',
    entityId: id,
    details: { name, visibility: vis },
    ipAddress: req.ip,
  });

  const created = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(id);
  res.status(201).json({ project: created });
});

app.get('/api/projects/:id', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const access = hasProjectAccess(req.user, projectId, 'read_only');
  if (!access.allowed) {
    return res.status(req.user ? 403 : 401).json({ error: access.reason });
  }
  const project = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(projectId);
  const members = db
    .prepare(
      `SELECT pm.id, pm.role, pm.added_at, u.id as user_id, u.name, u.email, u.title, u.institution
       FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ?`
    )
    .all(projectId);
  const activity = db
    .prepare(
      `SELECT a.*, u.name as actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT 30`
    )
    .all(projectId);
  res.json({ project, effectiveRole: access.effectiveRole, members, activity });
});

app.patch('/api/projects/:id', requireAuth, (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const access = hasProjectAccess(req.user, projectId, 'principal_investigator');
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  const { name, cancer_area, primary_objective, description, visibility, status } = req.body ?? {};
  const vis = visibility && ['restricted', 'organisation', 'public_read'].includes(visibility) ? visibility : null;
  const projStatus =
    status && ['active', 'paused', 'completed', 'archived'].includes(status) ? status : null;
  db.prepare(
    `UPDATE research_projects SET
      name = COALESCE(?, name),
      cancer_area = COALESCE(?, cancer_area),
      primary_objective = COALESCE(?, primary_objective),
      description = COALESCE(?, description),
      visibility = COALESCE(?, visibility),
      status = COALESCE(?, status),
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name ? String(name).trim() : null,
    cancer_area ? String(cancer_area).trim() : null,
    primary_objective !== undefined ? String(primary_objective).trim() : null,
    description !== undefined ? String(description).trim() : null,
    vis,
    projStatus,
    projectId
  );
  writeAuditLog({
    userId: req.user!.id,
    projectId,
    action: 'project_updated',
    entityType: 'research_project',
    entityId: projectId,
    details: req.body,
    ipAddress: req.ip,
  });
  res.json({ project: db.prepare('SELECT * FROM research_projects WHERE id = ?').get(projectId) });
});

app.delete('/api/projects/:id', requireAuth, (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const access = hasProjectAccess(req.user, projectId, 'principal_investigator');
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  db.prepare('DELETE FROM research_projects WHERE id = ?').run(projectId);
  writeAuditLog({
    userId: req.user!.id,
    action: 'project_deleted',
    entityType: 'research_project',
    entityId: projectId,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// ==========================================
// 4. AI RESEARCH ENGINE (GEMINI + 10-STEP WORKFLOW)
// ==========================================
app.get('/api/research/conversations', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId) {
    const access = hasProjectAccess(req.user, projectId, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
    const rows = db
      .prepare('SELECT * FROM research_conversations WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId);
    return res.json({ conversations: rows });
  }
  const rows = db
    .prepare('SELECT * FROM research_conversations WHERE user_id = ? ORDER BY updated_at DESC')
    .all(req.user!.id);
  res.json({ conversations: rows });
});

app.get('/api/research/conversations/:id', requireAuth, (req: Request, res: Response) => {
  const conv = db
    .prepare('SELECT * FROM research_conversations WHERE id = ?')
    .get(String(req.params.id)) as { id: string; project_id: string | null; user_id: string } | undefined;
  if (!conv) return res.status(404).json({ error: 'Investigation not found.' });
  if (conv.project_id) {
    const access = hasProjectAccess(req.user, conv.project_id, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (conv.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  const messages = db
    .prepare('SELECT * FROM research_messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conv.id);
  res.json({ conversation: conv, messages });
});

app.delete('/api/research/conversations/:id', requireAuth, (req: Request, res: Response) => {
  const conv = db
    .prepare('SELECT id, project_id, user_id FROM research_conversations WHERE id = ?')
    .get(String(req.params.id)) as { id: string; project_id: string | null; user_id: string } | undefined;
  if (!conv) return res.status(404).json({ error: 'Investigation not found.' });
  if (conv.project_id) {
    const access = hasProjectAccess(req.user, conv.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (conv.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM research_conversations WHERE id = ?').run(conv.id);
  writeAuditLog({
    userId: req.user!.id,
    projectId: conv.project_id,
    action: 'research_conversation_deleted',
    entityType: 'research_conversation',
    entityId: conv.id,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

async function executeInvestigationWorkflow(
  req: Request,
  onStage?: (stage: string, detail: string) => void
) {
  const {
    conversationId,
    projectId,
    question,
    objectives,
    cancerType,
    mechanisms,
    liveGrounding = true,
  } = req.body ?? {};

  if (!question || !String(question).trim()) {
    const err = new Error('A scientific research question is required.') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  if (projectId) {
    const access = hasProjectAccess(req.user, String(projectId), 'researcher');
    if (!access.allowed) {
      const err = new Error(access.reason || 'Access denied') as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }
  }

  let convId = conversationId ? String(conversationId) : null;
  if (!convId) {
    convId = newId('conv');
    db.prepare(
      `INSERT INTO research_conversations (id, project_id, user_id, title, research_question, objectives, cancer_type, mechanisms_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      convId,
      projectId || null,
      req.user!.id,
      String(question).trim().slice(0, 96),
      String(question).trim(),
      String(objectives || '').trim(),
      String(cancerType || '').trim(),
      JSON.stringify(Array.isArray(mechanisms) ? mechanisms : [])
    );
  } else {
    const existingConv = db
      .prepare('SELECT id, project_id, user_id FROM research_conversations WHERE id = ?')
      .get(convId) as { id: string; project_id: string | null; user_id: string } | undefined;
    if (!existingConv) {
      const err = new Error('Conversation thread not found.') as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    if (existingConv.project_id) {
      const convAccess = hasProjectAccess(req.user, existingConv.project_id, 'researcher');
      if (!convAccess.allowed) {
        const err = new Error(convAccess.reason || 'Access denied') as Error & { statusCode?: number };
        err.statusCode = 403;
        throw err;
      }
    } else if (existingConv.user_id !== req.user!.id && req.user!.role !== 'administrator') {
      const err = new Error('Forbidden') as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }
    db.prepare("UPDATE research_conversations SET updated_at = datetime('now') WHERE id = ?").run(convId);
  }

  const userMsgId = newId('msg');
  db.prepare(
    'INSERT INTO research_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
  ).run(userMsgId, convId, 'user', String(question).trim());

  const priorMsgs = db
    .prepare('SELECT role, content FROM research_messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(convId) as Array<{ role: 'user' | 'assistant'; content: string }>;

  const libraryCitations = projectId
    ? (
        db
          .prepare(
            'SELECT external_id as identifier, title, abstract, url, pub_type FROM literature_sources WHERE project_id = ? LIMIT 12'
          )
          .all(String(projectId)) as Array<{
          identifier: string;
          title: string;
          abstract: string;
          url: string;
          pub_type: string;
        }>
      )
    : [];

  let projectContextSummary = 'No project context attached.';
  if (projectId) {
    const proj = db.prepare('SELECT name, cancer_area, primary_objective FROM research_projects WHERE id = ?').get(String(projectId)) as
      | { name: string; cancer_area: string; primary_objective: string }
      | undefined;
    const dsCount = (db.prepare('SELECT COUNT(*) as c FROM research_datasets WHERE project_id = ?').get(String(projectId)) as { c: number }).c;
    const hypCount = (db.prepare('SELECT COUNT(*) as c FROM research_hypotheses WHERE project_id = ?').get(String(projectId)) as { c: number }).c;
    if (proj) {
      projectContextSummary = `Project "${proj.name}" (${proj.cancer_area}) — Objective: ${proj.primary_objective || 'N/A'}. Datasets linked: ${dsCount}, Hypotheses: ${hypCount}, Saved Literature: ${libraryCitations.length}.`;
    }
  }

  const activeModel = getSetting('gemini_model', 'gemini-4-hydrogen');
  const jobId = newId('job');
  db.prepare(
    'INSERT INTO analysis_jobs (id, project_id, user_id, job_type, status, parameters_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(jobId, projectId || null, req.user!.id, 'gemini_investigation', 'running', JSON.stringify({ model: activeModel }));

  onStage?.('initializing', `Thread ${convId} prepared. Launching scientific synthesis pipeline...`);

  const result = await runStructuredResearchInvestigation({
    model: activeModel,
    question: String(question).trim(),
    objectives: String(objectives || ''),
    cancerType: String(cancerType || ''),
    mechanisms: Array.isArray(mechanisms) ? mechanisms : [],
    projectContextSummary,
    libraryCitations,
    liveGroundingEnabled: Boolean(liveGrounding),
    history: priorMsgs.slice(0, -1),
    onStage,
  });

  const assistantMsgId = newId('msg');
  db.prepare(
    `INSERT INTO research_messages (id, conversation_id, role, content, structured_json, model_used, tokens_used, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assistantMsgId,
    convId,
    'assistant',
    result.structured.step10_findings_and_references.summary,
    JSON.stringify({
      structured: result.structured,
      retrievedLiterature: result.retrievedLiterature,
      literatureErrors: result.literatureErrors,
      citationAudit: result.citationAudit,
      failoverTriggered: result.failoverTriggered,
      failoverNote: result.failoverNote,
    }),
    result.modelUsed,
    result.tokensUsed,
    result.latencyMs
  );

  db.prepare(
    "UPDATE analysis_jobs SET status = 'completed', latency_ms = ?, completed_at = datetime('now') WHERE id = ?"
  ).run(result.latencyMs, jobId);

  writeAuditLog({
    userId: req.user!.id,
    projectId: projectId || null,
    action: 'ai_investigation_completed',
    entityType: 'research_conversation',
    entityId: convId,
    details: {
      model: result.modelUsed,
      failoverTriggered: result.failoverTriggered,
      strippedCitations: result.citationAudit.strippedCount,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
    },
    ipAddress: req.ip,
  });

  return {
    conversationId: convId,
    messageId: assistantMsgId,
    modelUsed: result.modelUsed,
    failoverTriggered: result.failoverTriggered,
    failoverNote: result.failoverNote,
    citationAudit: result.citationAudit,
    tokensUsed: result.tokensUsed,
    latencyMs: result.latencyMs,
    structured: result.structured,
    retrievedLiterature: result.retrievedLiterature,
    literatureErrors: result.literatureErrors,
  };
}

app.post('/api/research/investigate', requireAuth, async (req: Request, res: Response) => {
  try {
    const payload = await executeInvestigationWorkflow(req);
    res.json(payload);
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode || 500;
    const msg = err instanceof Error ? err.message : String(err);
    if (statusCode >= 500) {
      db.prepare(
        "INSERT INTO analysis_jobs (id, project_id, user_id, job_type, status, error_message, completed_at) VALUES (?, ?, ?, 'gemini_investigation', 'failed', ?, datetime('now'))"
      ).run(newId('job'), req.body?.projectId || null, req.user!.id, msg);
    }
    res.status(statusCode).json({ error: 'AI Research Engine failure', message: msg });
  }
});

app.post('/api/research/investigate-stream', requireAuth, async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  try {
    const payload = await executeInvestigationWorkflow(req, (stage, detail) => {
      writeSseEvent(res, 'stage', { stage, detail, timestamp: new Date().toISOString() });
    });
    writeSseEvent(res, 'complete', payload);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(
      "INSERT INTO analysis_jobs (id, project_id, user_id, job_type, status, error_message, completed_at) VALUES (?, ?, ?, 'gemini_investigation', 'failed', ?, datetime('now'))"
    ).run(newId('job'), req.body?.projectId || null, req.user!.id, msg);
    writeSseEvent(res, 'error', { message: msg });
    res.end();
  }
});

// ==========================================
// 5. LITERATURE INTELLIGENCE (REAL PUBLIC APIS)
// ==========================================
app.post('/api/literature/search', async (req: Request, res: Response) => {
  try {
    const { query, cancerType, pathway, methodology, pubType, sources, openAccessOnly, yearFrom } = req.body ?? {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: 'Search query is required.' });
    }
    const queryParts = [
      String(query).trim(),
      cancerType ? String(cancerType).trim() : '',
      pathway ? String(pathway).trim() : '',
      methodology ? String(methodology).trim() : '',
      pubType && pubType !== 'all' ? String(pubType).trim() : '',
    ].filter(Boolean);

    const searchRes = await searchIntegratedLiterature({
      query: queryParts.join(' AND '),
      sources: Array.isArray(sources) && sources.length ? sources : ['pubmed', 'europepmc', 'clinicaltrials'],
      openAccessOnly: Boolean(openAccessOnly),
      yearFrom: yearFrom ? String(yearFrom) : undefined,
      maxPerSource: 6,
    });

    res.json(searchRes);
  } catch (err) {
    res.status(500).json({ error: 'Literature search error', message: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/literature/analyze', requireAuth, async (req: Request, res: Response) => {
  try {
    const { articles, focusQuestion } = req.body ?? {};
    if (!Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ error: 'Provide at least one retrieved publication to analyse.' });
    }
    const model = getSetting('gemini_model', 'gemini-4-hydrogen');
    const out = await analyzeLiteratureCorpus({ model, articles, focusQuestion });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'Literature analysis error', message: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/literature/saved', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId) {
    const access = hasProjectAccess(req.user, projectId, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
    const rows = db.prepare('SELECT * FROM literature_sources WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
    return res.json({ items: rows });
  }
  const rows = db.prepare('SELECT * FROM literature_sources WHERE user_id = ? ORDER BY created_at DESC').all(req.user!.id);
  res.json({ items: rows });
});

app.post('/api/literature/save', requireAuth, (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.title || !b.source_db) {
    return res.status(400).json({ error: 'Publication title and source database are required.' });
  }
  if (b.project_id) {
    const access = hasProjectAccess(req.user, String(b.project_id), 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }

  const id = newId('lit');
  db.prepare(
    `INSERT INTO literature_sources (
      id, project_id, user_id, source_db, external_id, pmid, pmcid, doi, nct_id,
      title, authors_json, journal, pub_date, pub_type, is_preprint, correction_status,
      url, abstract, full_text_available, methodology_summary, main_findings, limitations, tags_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    b.project_id || null,
    req.user!.id,
    b.source_db,
    b.external_id || b.pmid || b.doi || id,
    b.pmid || null,
    b.pmcid || null,
    b.doi || null,
    b.nct_id || null,
    b.title,
    JSON.stringify(b.authors ?? []),
    b.journal || '',
    b.pub_date || '',
    b.pub_type || 'Research Article',
    b.is_preprint ? 1 : 0,
    b.correction_status || 'none',
    b.url || '',
    b.abstract || '',
    b.full_text_available ? 1 : 0,
    b.methodology_summary || '',
    b.main_findings || '',
    b.limitations || '',
    JSON.stringify(b.tags ?? [])
  );

  writeAuditLog({
    userId: req.user!.id,
    projectId: b.project_id || null,
    action: 'literature_saved',
    entityType: 'literature_source',
    entityId: id,
    details: { title: b.title, pmid: b.pmid, doi: b.doi },
    ipAddress: req.ip,
  });

  res.status(201).json({ item: db.prepare('SELECT * FROM literature_sources WHERE id = ?').get(id) });
});

app.delete('/api/literature/:id', requireAuth, (req: Request, res: Response) => {
  const item = db.prepare('SELECT * FROM literature_sources WHERE id = ?').get(String(req.params.id)) as
    | { id: string; user_id: string; project_id: string | null }
    | undefined;
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.project_id) {
    const access = hasProjectAccess(req.user, item.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (item.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM literature_sources WHERE id = ?').run(item.id);
  res.json({ ok: true });
});

// ==========================================
// 6. CANCER BIOLOGY KNOWLEDGE GRAPH
// ==========================================
app.get('/api/biology/graph', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId) {
    const access = hasProjectAccess(req.user, projectId, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }
  const entities = projectId
    ? db.prepare('SELECT * FROM biological_entities WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
    : db.prepare('SELECT * FROM biological_entities WHERE project_id IS NULL ORDER BY created_at DESC').all();
  const relationships = projectId
    ? db.prepare('SELECT * FROM molecular_relationships WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
    : db.prepare('SELECT * FROM molecular_relationships WHERE project_id IS NULL ORDER BY created_at DESC').all();
  res.json({ entities, relationships });
});

app.post('/api/biology/entities', requireAuth, (req: Request, res: Response) => {
  const { project_id, name, entity_type, mechanism_category, summary, genes, pathways } = req.body ?? {};
  if (!name || !entity_type || !mechanism_category) {
    return res.status(400).json({ error: 'Entity name, type, and mechanism category are required.' });
  }
  if (project_id) {
    const access = hasProjectAccess(req.user, String(project_id), 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }
  const id = newId('bio');
  db.prepare(
    `INSERT INTO biological_entities (id, project_id, name, entity_type, mechanism_category, summary, genes_json, pathways_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    project_id || null,
    String(name).trim(),
    String(entity_type),
    String(mechanism_category),
    String(summary || ''),
    JSON.stringify(Array.isArray(genes) ? genes : []),
    JSON.stringify(Array.isArray(pathways) ? pathways : [])
  );
  res.status(201).json({ entity: db.prepare('SELECT * FROM biological_entities WHERE id = ?').get(id) });
});

app.post('/api/biology/relationships', requireAuth, (req: Request, res: Response) => {
  const { project_id, source_entity_id, target_entity_id, relationship_type, evidence_level, supporting_ref, notes } =
    req.body ?? {};
  if (!source_entity_id || !target_entity_id || !relationship_type) {
    return res.status(400).json({ error: 'Source entity, target entity, and relationship type are required.' });
  }
  if (project_id) {
    const access = hasProjectAccess(req.user, String(project_id), 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }
  const id = newId('rel');
  db.prepare(
    `INSERT INTO molecular_relationships (id, project_id, source_entity_id, target_entity_id, relationship_type, evidence_level, supporting_ref, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    project_id || null,
    source_entity_id,
    target_entity_id,
    relationship_type,
    evidence_level || 'observational',
    supporting_ref || '',
    notes || ''
  );
  res.status(201).json({ relationship: db.prepare('SELECT * FROM molecular_relationships WHERE id = ?').get(id) });
});

app.delete('/api/biology/entities/:id', requireAuth, (req: Request, res: Response) => {
  const ent = db.prepare('SELECT * FROM biological_entities WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null }
    | undefined;
  if (!ent) return res.status(404).json({ error: 'Biological entity not found.' });
  if (ent.project_id) {
    const access = hasProjectAccess(req.user, ent.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }
  db.prepare('DELETE FROM molecular_relationships WHERE source_entity_id = ? OR target_entity_id = ?').run(ent.id, ent.id);
  db.prepare('DELETE FROM biological_entities WHERE id = ?').run(ent.id);
  res.json({ ok: true });
});

app.delete('/api/biology/relationships/:id', requireAuth, (req: Request, res: Response) => {
  const rel = db.prepare('SELECT * FROM molecular_relationships WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null }
    | undefined;
  if (!rel) return res.status(404).json({ error: 'Relationship not found.' });
  if (rel.project_id) {
    const access = hasProjectAccess(req.user, rel.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }
  db.prepare('DELETE FROM molecular_relationships WHERE id = ?').run(rel.id);
  res.json({ ok: true });
});

// ==========================================
// 7. MOLECULAR INTELLIGENCE & DATA ANALYTICS
// ==========================================
app.get('/api/datasets', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId) {
    const access = hasProjectAccess(req.user, projectId, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
    const datasets = db.prepare('SELECT * FROM research_datasets WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
    return res.json({ datasets });
  }
  const datasets = db.prepare('SELECT * FROM research_datasets WHERE user_id = ? ORDER BY created_at DESC').all(req.user!.id);
  res.json({ datasets });
});

app.post('/api/datasets/upload', requireAuth, datasetUpload.single('file'), (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Dataset file is required (CSV, TSV, JSON, or VCF).' });
    const projectId = req.body.projectId ? String(req.body.projectId) : null;
    const isSynthetic = req.body.isSynthetic === 'true';

    if (projectId) {
      const access = hasProjectAccess(req.user, projectId, 'researcher');
      if (!access.allowed) {
        fs.unlinkSync(file.path);
        return res.status(403).json({ error: access.reason });
      }
    }

    const rawText = fs.readFileSync(file.path, 'utf8');
    const parsed = parseDatasetContent(rawText, file.originalname);
    const datasetId = newId('ds');

    db.prepare(
      `INSERT INTO research_datasets (id, project_id, user_id, name, format, original_filename, file_path, row_count, col_count, missing_count, is_synthetic, validation_summary_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      datasetId,
      projectId,
      req.user!.id,
      String(req.body.name || file.originalname).trim(),
      parsed.format,
      file.originalname,
      file.path,
      parsed.rowCount,
      parsed.colCount,
      parsed.totalMissing,
      isSynthetic ? 1 : 0,
      JSON.stringify({ warnings: parsed.warnings, vcfSummary: parsed.vcfSummary ?? null }),
      JSON.stringify({ headers: parsed.headers, deidentifiedDeclared: req.body.deidentified === 'true' })
    );

    const insertVar = db.prepare(
      `INSERT INTO dataset_variables (id, dataset_id, variable_name, data_type, missing_count, mean_val, median_val, std_val, min_val, max_val)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const v of parsed.variables) {
      insertVar.run(newId('var'), datasetId, v.name, v.dataType, v.missingCount, v.mean, v.median, v.std, v.min, v.max);
    }

    const insertSample = db.prepare(
      `INSERT INTO dataset_samples (id, dataset_id, sample_identifier, group_label, survival_time, event_status, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    parsed.rows.slice(0, 500).forEach((row, idx) => {
      const idCol = parsed.headers.find((h) => /sample|patient|id/i.test(h)) || parsed.headers[0];
      const grpCol = parsed.headers.find((h) => /cohort|group|condition|subtype|arm/i.test(h));
      const timeCol = parsed.headers.find((h) => /survival|time|os_months|days/i.test(h));
      const evCol = parsed.headers.find((h) => /event|status|deceased|vital/i.test(h));
      insertSample.run(
        newId('smp'),
        datasetId,
        String(row[idCol] ?? `row_${idx + 1}`),
        grpCol ? String(row[grpCol] ?? '') : '',
        timeCol && typeof row[timeCol] === 'number' ? row[timeCol] : null,
        evCol && typeof row[evCol] === 'number' ? row[evCol] : null,
        JSON.stringify(row)
      );
    });

    writeAuditLog({
      userId: req.user!.id,
      projectId,
      action: 'dataset_imported',
      entityType: 'research_dataset',
      entityId: datasetId,
      details: { filename: file.originalname, format: parsed.format, rows: parsed.rowCount, isSynthetic },
      ipAddress: req.ip,
    });

    res.status(201).json({
      dataset: db.prepare('SELECT * FROM research_datasets WHERE id = ?').get(datasetId),
      variables: parsed.variables,
      previewRows: parsed.rows.slice(0, 50),
      warnings: parsed.warnings,
      vcfSummary: parsed.vcfSummary,
    });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // non-fatal cleanup
      }
    }
    res.status(400).json({ error: 'Dataset validation failed', message: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/datasets/synthetic-demo', requireAuth, (req: Request, res: Response) => {
  try {
    const projectId = req.body.projectId ? String(req.body.projectId) : null;
    if (projectId) {
      const access = hasProjectAccess(req.user, projectId, 'researcher');
      if (!access.allowed) return res.status(403).json({ error: access.reason });
    }
    const demo = generateExplicitSyntheticDemoCsv();
    const filePath = path.join(UPLOAD_DIR, 'datasets', `${newId('synth')}_${demo.filename}`);
    fs.writeFileSync(filePath, demo.content, 'utf8');
    const parsed = parseDatasetContent(demo.content, demo.filename);
    const datasetId = newId('ds');

    db.prepare(
      `INSERT INTO research_datasets (id, project_id, user_id, name, format, original_filename, file_path, row_count, col_count, missing_count, is_synthetic, validation_summary_json, metadata_json)
       VALUES (?, ?, ?, ?, 'csv', ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      datasetId,
      projectId,
      req.user!.id,
      'SYNTHETIC DATA — Simulated Hypoxia & Immune Checkpoint Cohort (n=40)',
      demo.filename,
      filePath,
      parsed.rowCount,
      parsed.colCount,
      parsed.totalMissing,
      JSON.stringify({ warnings: ['SYNTHETIC DATA: Generated for statistical pipeline verification only. Not real patient measurements.'] }),
      JSON.stringify({ headers: parsed.headers, synthetic: true })
    );

    const insertVar = db.prepare(
      `INSERT INTO dataset_variables (id, dataset_id, variable_name, data_type, missing_count, mean_val, median_val, std_val, min_val, max_val)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const v of parsed.variables) {
      insertVar.run(newId('var'), datasetId, v.name, v.dataType, v.missingCount, v.mean, v.median, v.std, v.min, v.max);
    }

    const insertSample = db.prepare(
      `INSERT INTO dataset_samples (id, dataset_id, sample_identifier, group_label, survival_time, event_status, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    parsed.rows.slice(0, 500).forEach((row, idx) => {
      const idCol = parsed.headers.find((h) => /sample|patient|id/i.test(h)) || parsed.headers[0];
      const grpCol = parsed.headers.find((h) => /cohort|group|condition|subtype|arm/i.test(h));
      const timeCol = parsed.headers.find((h) => /survival|time|os_months|days/i.test(h));
      const evCol = parsed.headers.find((h) => /event|status|deceased|vital/i.test(h));
      insertSample.run(
        newId('smp'),
        datasetId,
        String(row[idCol] ?? `row_${idx + 1}`),
        grpCol ? String(row[grpCol] ?? '') : '',
        timeCol && typeof row[timeCol] === 'number' ? row[timeCol] : null,
        evCol && typeof row[evCol] === 'number' ? row[evCol] : null,
        JSON.stringify(row)
      );
    });

    writeAuditLog({
      userId: req.user!.id,
      projectId,
      action: 'synthetic_dataset_created',
      entityType: 'research_dataset',
      entityId: datasetId,
      ipAddress: req.ip,
    });

    res.status(201).json({
      dataset: db.prepare('SELECT * FROM research_datasets WHERE id = ?').get(datasetId),
      variables: parsed.variables,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/datasets/:id', requireAuth, (req: Request, res: Response) => {
  const ds = db.prepare('SELECT * FROM research_datasets WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string; file_path: string; original_filename: string }
    | undefined;
  if (!ds) return res.status(404).json({ error: 'Dataset not found.' });
  if (ds.project_id) {
    const access = hasProjectAccess(req.user, ds.project_id, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (ds.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const rawText = fs.existsSync(ds.file_path) ? fs.readFileSync(ds.file_path, 'utf8') : '';
  const parsed = rawText ? parseDatasetContent(rawText, ds.original_filename) : null;
  const variables = db.prepare('SELECT * FROM dataset_variables WHERE dataset_id = ?').all(ds.id);

  res.json({
    dataset: ds,
    variables,
    parsedVariables: parsed?.variables ?? [],
    rows: parsed?.rows ?? [],
    headers: parsed?.headers ?? [],
    vcfSummary: parsed?.vcfSummary ?? null,
  });
});

app.delete('/api/datasets/:id', requireAuth, (req: Request, res: Response) => {
  const ds = db.prepare('SELECT id, project_id, user_id, file_path FROM research_datasets WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string; file_path: string }
    | undefined;
  if (!ds) return res.status(404).json({ error: 'Dataset not found.' });
  if (ds.project_id) {
    const access = hasProjectAccess(req.user, ds.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (ds.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM research_datasets WHERE id = ?').run(ds.id);
  if (ds.file_path && fs.existsSync(ds.file_path)) {
    try {
      fs.unlinkSync(ds.file_path);
    } catch {
      // non-fatal cleanup
    }
  }
  writeAuditLog({
    userId: req.user!.id,
    projectId: ds.project_id,
    action: 'dataset_deleted',
    entityType: 'research_dataset',
    entityId: ds.id,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

app.get('/api/connectors/omics', requireAuth, async (req: Request, res: Response) => {
  try {
    const cancerArea = String(req.query.cancerArea || 'lung adenocarcinoma').trim();
    const rawGenes = String(req.query.genes || 'TP53,EGFR,KRAS,PIK3CA,CD274,HIF1A');
    const genes = rawGenes
      .split(/[\s,;]+/)
      .map((g) => g.trim())
      .filter(Boolean);
    const out = await queryOmicsMutationLandscape({ cancerArea, genes });
    res.json(out);
  } catch (err) {
    res.status(500).json({
      error: 'Live omics connector error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get('/api/connectors/pharmacology', requireAuth, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Provide an agent or compound name (>= 2 characters).' });
    }
    const out = await lookupPharmacologyTargets(q);
    res.json(out);
  } catch (err) {
    res.status(500).json({
      error: 'Live pharmacology connector error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/api/analytics/run', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      datasetId,
      analysisType,
      variables,
      groupCol,
      groupA,
      groupB,
      timeCol,
      eventCol,
      geneList,
      projectId,
      useLivePathways,
    } = req.body ?? {};
    const started = Date.now();

    if (analysisType === 'pathway_enrichment') {
      const scopedProjectId = projectId ? String(projectId) : null;
      if (scopedProjectId) {
        const access = hasProjectAccess(req.user, scopedProjectId, 'read_only');
        if (!access.allowed) return res.status(403).json({ error: access.reason });
      }
      const genes = Array.isArray(geneList)
        ? geneList
        : String(geneList || '')
            .split(/[\s,;]+/)
            .filter(Boolean);
      if (genes.length === 0) return res.status(400).json({ error: 'Provide at least one gene symbol.' });
      const localResult = computePathwayEnrichment(genes);
      let liveData: Awaited<ReturnType<typeof queryLivePathwaysEnrichrReactome>> | null = null;
      if (useLivePathways) {
        liveData = await queryLivePathwaysEnrichrReactome(genes);
      }
      const result = {
        ...localResult,
        livePathways: liveData?.pathways ?? [],
        liveErrors: liveData?.errors ?? [],
        enrichrUserListId: liveData?.userListId ?? null,
      };
      const jobId = newId('job');
      db.prepare(
        "INSERT INTO analysis_jobs (id, project_id, user_id, job_type, status, parameters_json, result_json, latency_ms, completed_at) VALUES (?, ?, ?, 'pathway_enrichment', 'completed', ?, ?, ?, datetime('now'))"
      ).run(
        jobId,
        scopedProjectId,
        req.user!.id,
        JSON.stringify({ genes, useLivePathways: Boolean(useLivePathways) }),
        JSON.stringify(result),
        Date.now() - started
      );
      return res.json({ jobId, analysisType, result });
    }

    const ds = db.prepare('SELECT * FROM research_datasets WHERE id = ?').get(String(datasetId)) as
      | { id: string; project_id: string | null; user_id: string; file_path: string; original_filename: string; is_synthetic: number }
      | undefined;
    if (!ds) return res.status(404).json({ error: 'Dataset not found.' });
    if (ds.project_id) {
      const access = hasProjectAccess(req.user, ds.project_id, 'read_only');
      if (!access.allowed) return res.status(403).json({ error: access.reason });
    } else if (ds.user_id !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const rawText = fs.readFileSync(ds.file_path, 'utf8');
    const parsed = parseDatasetContent(rawText, ds.original_filename);
    const numericCols = parsed.variables.filter((v) => v.dataType === 'numeric').map((v) => v.name);

    let result: unknown;
    if (analysisType === 'correlation') {
      const targetVars = Array.isArray(variables) && variables.length >= 2 ? variables : numericCols.slice(0, 8);
      if (targetVars.length < 2) return res.status(400).json({ error: 'At least 2 numeric variables are required for correlation analysis.' });
      result = computeCorrelationMatrix(parsed.rows, targetVars);
    } else if (analysisType === 'differential_expression') {
      if (!groupCol || !groupA || !groupB) {
        return res.status(400).json({ error: 'Grouping column and two group labels are required.' });
      }
      result = computeDifferentialExpression(parsed.rows, groupCol, groupA, groupB, numericCols);
    } else if (analysisType === 'kaplan_meier') {
      if (!timeCol || !eventCol) {
        return res.status(400).json({ error: 'Survival time column and event status column are required.' });
      }
      result = computeKaplanMeier(parsed.rows, timeCol, eventCol, groupCol || undefined);
    } else {
      result = {
        methodology: 'Sample descriptive statistics with 95% confidence intervals',
        variables: parsed.variables,
        rowCount: parsed.rowCount,
      };
    }

    const jobId = newId('job');
    db.prepare(
      "INSERT INTO analysis_jobs (id, project_id, user_id, job_type, status, parameters_json, result_json, latency_ms, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, datetime('now'))"
    ).run(
      jobId,
      ds.project_id,
      req.user!.id,
      analysisType || 'descriptive',
      JSON.stringify({ datasetId, variables, groupCol, groupA, groupB, timeCol, eventCol }),
      JSON.stringify(result),
      Date.now() - started
    );

    res.json({ jobId, analysisType, isSynthetic: Boolean(ds.is_synthetic), result });
  } catch (err) {
    res.status(400).json({ error: 'Statistical analysis failed', message: err instanceof Error ? err.message : String(err) });
  }
});

// ==========================================
// 8. PATHOLOGY INTELLIGENCE
// ==========================================
app.get('/api/pathology/images', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId) {
    const access = hasProjectAccess(req.user, projectId, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
    return res.json({
      images: db.prepare('SELECT * FROM pathology_images WHERE project_id = ? ORDER BY created_at DESC').all(projectId),
    });
  }
  res.json({
    images: db.prepare('SELECT * FROM pathology_images WHERE user_id = ? ORDER BY created_at DESC').all(req.user!.id),
  });
});

app.post('/api/pathology/upload', requireAuth, pathologyUpload.single('image'), (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Histopathology image file (PNG, JPEG, TIFF) is required.' });
  try {
    const projectId = req.body.projectId ? String(req.body.projectId) : null;
    if (projectId) {
      const access = hasProjectAccess(req.user, projectId, 'researcher');
      if (!access.allowed) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(403).json({ error: access.reason });
      }
    }
    const id = newId('img');
    db.prepare(
      `INSERT INTO pathology_images (id, project_id, user_id, title, filename, file_path, mime_type, file_size, stain_type, magnification, tissue_origin, notes, model_connected)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none')`
    ).run(
      id,
      projectId,
      req.user!.id,
      String(req.body.title || file.originalname).trim(),
      file.originalname,
      file.path,
      file.mimetype,
      file.size,
      String(req.body.stainType || 'H&E'),
      String(req.body.magnification || '20x'),
      String(req.body.tissueOrigin || ''),
      String(req.body.notes || '')
    );

    writeAuditLog({
      userId: req.user!.id,
      projectId,
      action: 'pathology_image_uploaded',
      entityType: 'pathology_image',
      entityId: id,
      details: { filename: file.originalname, size: file.size },
      ipAddress: req.ip,
    });

    res.status(201).json({ image: db.prepare('SELECT * FROM pathology_images WHERE id = ?').get(id) });
  } catch (err) {
    if (fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // non-fatal cleanup
      }
    }
    res.status(400).json({ error: 'Pathology slide upload failed', message: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/pathology/images/:id/file', requireAuth, (req: Request, res: Response) => {
  const img = db.prepare('SELECT * FROM pathology_images WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string; file_path: string; mime_type: string }
    | undefined;
  if (!img || !fs.existsSync(img.file_path)) return res.status(404).json({ error: 'Image not found.' });
  if (img.project_id) {
    const access = hasProjectAccess(req.user, img.project_id, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (img.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Content-Type', img.mime_type);
  const stream = fs.createReadStream(img.file_path);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream pathology slide file.' });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
});

app.get('/api/pathology/images/:id/annotations', requireAuth, (req: Request, res: Response) => {
  const img = db.prepare('SELECT id, project_id, user_id FROM pathology_images WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!img) return res.status(404).json({ error: 'Histopathology slide not found.' });
  if (img.project_id) {
    const access = hasProjectAccess(req.user, img.project_id, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (img.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const annotations = db
    .prepare(
      `SELECT a.*, u.name as author_name FROM image_annotations a
       JOIN users u ON u.id = a.user_id WHERE a.image_id = ? ORDER BY a.created_at DESC`
    )
    .all(img.id);
  res.json({ annotations });
});

app.post('/api/pathology/images/:id/annotations', requireAuth, (req: Request, res: Response) => {
  const img = db.prepare('SELECT id, project_id, user_id FROM pathology_images WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!img) return res.status(404).json({ error: 'Histopathology slide not found.' });
  if (img.project_id) {
    const access = hasProjectAccess(req.user, img.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (img.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { label, annotation_type, region, notes } = req.body ?? {};
  if (!label) return res.status(400).json({ error: 'Annotation label is required.' });
  const id = newId('ann');
  db.prepare(
    `INSERT INTO image_annotations (id, image_id, user_id, annotation_type, label, region_json, measurement_source, notes)
     VALUES (?, ?, ?, ?, ?, ?, 'manual_annotation', ?)`
  ).run(id, img.id, req.user!.id, annotation_type || 'manual_roi', String(label).trim(), JSON.stringify(region ?? {}), String(notes || ''));
  res.status(201).json({ annotation: db.prepare('SELECT * FROM image_annotations WHERE id = ?').get(id) });
});

app.delete('/api/pathology/annotations/:annId', requireAuth, (req: Request, res: Response) => {
  const ann = db
    .prepare(
      `SELECT a.id, a.user_id, pi.project_id FROM image_annotations a
       JOIN pathology_images pi ON pi.id = a.image_id WHERE a.id = ?`
    )
    .get(String(req.params.annId)) as { id: string; user_id: string; project_id: string | null } | undefined;
  if (!ann) return res.status(404).json({ error: 'Annotation not found.' });
  if (ann.project_id) {
    const access = hasProjectAccess(req.user, ann.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (ann.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM image_annotations WHERE id = ?').run(ann.id);
  res.json({ ok: true });
});

app.delete('/api/pathology/images/:id', requireAuth, (req: Request, res: Response) => {
  const img = db.prepare('SELECT * FROM pathology_images WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string; file_path: string }
    | undefined;
  if (!img) return res.status(404).json({ error: 'Histopathology slide not found.' });
  if (img.project_id) {
    const access = hasProjectAccess(req.user, img.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (img.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM image_annotations WHERE image_id = ?').run(img.id);
  db.prepare('DELETE FROM pathology_images WHERE id = ?').run(img.id);
  try {
    if (img.file_path && fs.existsSync(img.file_path)) fs.unlinkSync(img.file_path);
  } catch {
    // Non-fatal file cleanup
  }
  res.json({ ok: true });
});

// ==========================================
// 9. HYPOTHESIS LAB & EVIDENCE LINKING
// ==========================================
app.get('/api/hypotheses', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  let hypotheses: Array<Record<string, unknown>>;
  if (projectId) {
    const access = hasProjectAccess(req.user, projectId, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
    hypotheses = db
      .prepare('SELECT * FROM research_hypotheses WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Array<Record<string, unknown>>;
  } else {
    hypotheses = db
      .prepare('SELECT * FROM research_hypotheses WHERE user_id = ? ORDER BY updated_at DESC')
      .all(req.user!.id) as Array<Record<string, unknown>>;
  }

  const withEvidence = hypotheses.map((h) => ({
    ...h,
    evidence: db.prepare('SELECT * FROM hypothesis_evidence WHERE hypothesis_id = ? ORDER BY created_at DESC').all(String(h.id)),
  }));
  res.json({ hypotheses: withEvidence });
});

app.post('/api/hypotheses', requireAuth, (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.title || !b.research_question) {
    return res.status(400).json({ error: 'Hypothesis title and research question are required.' });
  }
  if (b.project_id) {
    const access = hasProjectAccess(req.user, String(b.project_id), 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }
  const id = newId('hyp');
  db.prepare(
    `INSERT INTO research_hypotheses (
      id, project_id, user_id, title, research_question, biological_rationale, proposed_mechanism,
      relevant_genes_json, assumptions, limitations, confidence_level, validation_approach, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    b.project_id || null,
    req.user!.id,
    String(b.title).trim(),
    String(b.research_question).trim(),
    String(b.biological_rationale || ''),
    String(b.proposed_mechanism || ''),
    JSON.stringify(Array.isArray(b.relevant_genes) ? b.relevant_genes : []),
    String(b.assumptions || ''),
    String(b.limitations || ''),
    String(b.confidence_level || 'low_preliminary'),
    String(b.validation_approach || ''),
    'generated'
  );

  if (Array.isArray(b.initial_evidence)) {
    const insEv = db.prepare(
      `INSERT INTO hypothesis_evidence (id, hypothesis_id, evidence_type, polarity, source_type, source_id, citation_label, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ev of b.initial_evidence) {
      insEv.run(
        newId('ev'),
        id,
        ev.evidence_type || 'literature',
        ev.polarity || 'supporting',
        ev.source_type || 'linked_record',
        ev.source_id || '',
        ev.citation_label || 'Linked Source',
        ev.summary || ''
      );
    }
  }

  writeAuditLog({
    userId: req.user!.id,
    projectId: b.project_id || null,
    action: 'hypothesis_created',
    entityType: 'research_hypothesis',
    entityId: id,
    details: { title: b.title },
    ipAddress: req.ip,
  });

  const created = db.prepare('SELECT * FROM research_hypotheses WHERE id = ?').get(id);
  const evidence = db.prepare('SELECT * FROM hypothesis_evidence WHERE hypothesis_id = ?').all(id);
  res.status(201).json({ hypothesis: { ...(created as object), evidence } });
});

app.patch('/api/hypotheses/:id', requireAuth, (req: Request, res: Response) => {
  const hyp = db.prepare('SELECT * FROM research_hypotheses WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!hyp) return res.status(404).json({ error: 'Hypothesis not found.' });
  if (hyp.project_id) {
    const access = hasProjectAccess(req.user, hyp.project_id, 'reviewer');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (hyp.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { status, confidence_level, limitations, validation_approach } = req.body ?? {};
  db.prepare(
    `UPDATE research_hypotheses SET
      status = COALESCE(?, status),
      confidence_level = COALESCE(?, confidence_level),
      limitations = COALESCE(?, limitations),
      validation_approach = COALESCE(?, validation_approach),
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(status || null, confidence_level || null, limitations || null, validation_approach || null, hyp.id);

  writeAuditLog({
    userId: req.user!.id,
    projectId: hyp.project_id,
    action: 'hypothesis_updated',
    entityType: 'research_hypothesis',
    entityId: hyp.id,
    details: { status, confidence_level },
    ipAddress: req.ip,
  });

  const updatedHyp = db.prepare('SELECT * FROM research_hypotheses WHERE id = ?').get(hyp.id);
  const evidence = db.prepare('SELECT * FROM hypothesis_evidence WHERE hypothesis_id = ?').all(hyp.id);
  res.json({ hypothesis: { ...(updatedHyp as object), evidence } });
});

app.post('/api/hypotheses/:id/evidence', requireAuth, (req: Request, res: Response) => {
  const hyp = db.prepare('SELECT id, project_id, user_id FROM research_hypotheses WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!hyp) return res.status(404).json({ error: 'Hypothesis not found.' });
  if (hyp.project_id) {
    const access = hasProjectAccess(req.user, hyp.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (hyp.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { evidence_type, polarity, source_type, source_id, citation_label, summary } = req.body ?? {};
  if (!citation_label || !summary) {
    return res.status(400).json({ error: 'Citation label and evidence summary are required.' });
  }
  const id = newId('ev');
  db.prepare(
    `INSERT INTO hypothesis_evidence (id, hypothesis_id, evidence_type, polarity, source_type, source_id, citation_label, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    hyp.id,
    evidence_type || 'literature',
    polarity || 'supporting',
    source_type || 'manual',
    source_id || '',
    citation_label,
    summary
  );
  writeAuditLog({
    userId: req.user!.id,
    projectId: hyp.project_id,
    action: 'hypothesis_evidence_added',
    entityType: 'hypothesis_evidence',
    entityId: id,
    ipAddress: req.ip,
  });
  res.status(201).json({ evidence: db.prepare('SELECT * FROM hypothesis_evidence WHERE id = ?').get(id) });
});

app.delete('/api/hypotheses/:id/evidence/:evidenceId', requireAuth, (req: Request, res: Response) => {
  const hyp = db.prepare('SELECT id, project_id, user_id FROM research_hypotheses WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!hyp) return res.status(404).json({ error: 'Hypothesis not found.' });
  if (hyp.project_id) {
    const access = hasProjectAccess(req.user, hyp.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (hyp.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM hypothesis_evidence WHERE id = ? AND hypothesis_id = ?').run(
    String(req.params.evidenceId),
    hyp.id
  );
  writeAuditLog({
    userId: req.user!.id,
    projectId: hyp.project_id,
    action: 'hypothesis_evidence_deleted',
    entityType: 'hypothesis_evidence',
    entityId: String(req.params.evidenceId),
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

app.delete('/api/hypotheses/:id', requireAuth, (req: Request, res: Response) => {
  const hyp = db.prepare('SELECT * FROM research_hypotheses WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!hyp) return res.status(404).json({ error: 'Hypothesis not found.' });
  if (hyp.project_id) {
    const access = hasProjectAccess(req.user, hyp.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (hyp.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM hypothesis_evidence WHERE hypothesis_id = ?').run(hyp.id);
  db.prepare('DELETE FROM research_hypotheses WHERE id = ?').run(hyp.id);
  writeAuditLog({
    userId: req.user!.id,
    projectId: hyp.project_id,
    action: 'hypothesis_deleted',
    entityType: 'research_hypothesis',
    entityId: hyp.id,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// ==========================================
// 10. EXPERIMENT DESIGN
// ==========================================
app.get('/api/experiments', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId) {
    const access = hasProjectAccess(req.user, projectId, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
    return res.json({
      experiments: db.prepare('SELECT * FROM experiment_plans WHERE project_id = ? ORDER BY updated_at DESC').all(projectId),
    });
  }
  res.json({
    experiments: db.prepare('SELECT * FROM experiment_plans WHERE user_id = ? ORDER BY updated_at DESC').all(req.user!.id),
  });
});

app.post('/api/experiments', requireAuth, (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.title || !b.scientific_question) {
    return res.status(400).json({ error: 'Experiment title and scientific question are required.' });
  }
  if (b.project_id) {
    const access = hasProjectAccess(req.user, String(b.project_id), 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }
  const id = newId('exp');
  db.prepare(
    `INSERT INTO experiment_plans (
      id, project_id, hypothesis_id, user_id, title, objectives, scientific_question, study_design,
      independent_vars_json, dependent_vars_json, control_groups, sample_characteristics,
      sample_size_assumptions, statistical_methods, expected_outcomes, potential_confounders,
      limitations, validation_requirements, reproducibility_checklist_json, ethics_checklist_json, version, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'proposal_draft')`
  ).run(
    id,
    b.project_id || null,
    b.hypothesis_id || null,
    req.user!.id,
    String(b.title).trim(),
    String(b.objectives || ''),
    String(b.scientific_question).trim(),
    String(b.study_design || ''),
    JSON.stringify(b.independent_vars ?? []),
    JSON.stringify(b.dependent_vars ?? []),
    String(b.control_groups || ''),
    String(b.sample_characteristics || ''),
    String(b.sample_size_assumptions || ''),
    String(b.statistical_methods || ''),
    String(b.expected_outcomes || ''),
    String(b.potential_confounders || ''),
    String(b.limitations || ''),
    String(b.validation_requirements || ''),
    JSON.stringify(b.reproducibility_checklist ?? []),
    JSON.stringify(b.ethics_checklist ?? [])
  );

  writeAuditLog({
    userId: req.user!.id,
    projectId: b.project_id || null,
    action: 'experiment_plan_created',
    entityType: 'experiment_plan',
    entityId: id,
    details: { title: b.title, hypothesis_id: b.hypothesis_id },
    ipAddress: req.ip,
  });

  res.status(201).json({ experiment: db.prepare('SELECT * FROM experiment_plans WHERE id = ?').get(id) });
});

app.patch('/api/experiments/:id', requireAuth, (req: Request, res: Response) => {
  const exp = db.prepare('SELECT * FROM experiment_plans WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string; version: number }
    | undefined;
  if (!exp) return res.status(404).json({ error: 'Experiment plan not found.' });
  if (exp.project_id) {
    const access = hasProjectAccess(req.user, exp.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (exp.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const b = req.body ?? {};
  db.prepare(
    `UPDATE experiment_plans SET
      study_design = COALESCE(?, study_design),
      statistical_methods = COALESCE(?, statistical_methods),
      reproducibility_checklist_json = COALESCE(?, reproducibility_checklist_json),
      ethics_checklist_json = COALESCE(?, ethics_checklist_json),
      status = COALESCE(?, status),
      version = version + 1,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    b.study_design ?? null,
    b.statistical_methods ?? null,
    b.reproducibility_checklist ? JSON.stringify(b.reproducibility_checklist) : null,
    b.ethics_checklist ? JSON.stringify(b.ethics_checklist) : null,
    b.status ?? null,
    exp.id
  );
  res.json({ experiment: db.prepare('SELECT * FROM experiment_plans WHERE id = ?').get(exp.id) });
});

app.delete('/api/experiments/:id', requireAuth, (req: Request, res: Response) => {
  const exp = db.prepare('SELECT * FROM experiment_plans WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!exp) return res.status(404).json({ error: 'Experiment plan not found.' });
  if (exp.project_id) {
    const access = hasProjectAccess(req.user, exp.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (exp.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM experiment_plans WHERE id = ?').run(exp.id);
  res.json({ ok: true });
});

// ==========================================
// 11. RESEARCH LIBRARY (DOCUMENTS, NOTES, VERSIONING)
// ==========================================
app.get('/api/library/documents', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId) {
    const access = hasProjectAccess(req.user, projectId, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
    return res.json({
      documents: db.prepare('SELECT * FROM research_documents WHERE project_id = ? ORDER BY updated_at DESC').all(projectId),
    });
  }
  res.json({
    documents: db.prepare('SELECT * FROM research_documents WHERE user_id = ? ORDER BY updated_at DESC').all(req.user!.id),
  });
});

app.post('/api/library/documents', requireAuth, (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.title || !b.item_type) {
    return res.status(400).json({ error: 'Title and item type are required.' });
  }
  if (b.project_id) {
    const access = hasProjectAccess(req.user, String(b.project_id), 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }
  const id = newId('doc');
  db.prepare(
    `INSERT INTO research_documents (id, project_id, user_id, item_type, title, category, folder, tags_json, content, metadata_json, source_ref, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    id,
    b.project_id || null,
    req.user!.id,
    b.item_type,
    String(b.title).trim(),
    b.category || 'General',
    b.folder || 'Root',
    JSON.stringify(b.tags ?? []),
    String(b.content || ''),
    JSON.stringify(b.metadata ?? {}),
    String(b.source_ref || ''),
  );
  db.prepare('INSERT INTO document_versions (id, document_id, version, content, edited_by) VALUES (?, ?, 1, ?, ?)').run(
    newId('ver'),
    id,
    String(b.content || ''),
    req.user!.id
  );
  res.status(201).json({ document: db.prepare('SELECT * FROM research_documents WHERE id = ?').get(id) });
});

app.patch('/api/library/documents/:id', requireAuth, (req: Request, res: Response) => {
  const doc = db.prepare('SELECT * FROM research_documents WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string; version: number }
    | undefined;
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (doc.project_id) {
    const access = hasProjectAccess(req.user, doc.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (doc.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { content, title } = req.body ?? {};
  const nextVer = doc.version + 1;
  db.prepare(
    "UPDATE research_documents SET title = COALESCE(?, title), content = COALESCE(?, content), version = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title ?? null, content ?? null, nextVer, doc.id);
  db.prepare('INSERT INTO document_versions (id, document_id, version, content, edited_by) VALUES (?, ?, ?, ?, ?)').run(
    newId('ver'),
    doc.id,
    nextVer,
    String(content || ''),
    req.user!.id
  );
  res.json({ document: db.prepare('SELECT * FROM research_documents WHERE id = ?').get(doc.id) });
});

app.get('/api/library/documents/:id/versions', requireAuth, (req: Request, res: Response) => {
  const doc = db.prepare('SELECT * FROM research_documents WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (doc.project_id) {
    const access = hasProjectAccess(req.user, doc.project_id, 'read_only');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (doc.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const versions = db
    .prepare(
      `SELECT dv.*, u.name as editor_name FROM document_versions dv
       LEFT JOIN users u ON u.id = dv.edited_by
       WHERE dv.document_id = ? ORDER BY dv.version DESC`
    )
    .all(doc.id);
  res.json({ versions });
});

app.delete('/api/library/documents/:id', requireAuth, (req: Request, res: Response) => {
  const doc = db.prepare('SELECT * FROM research_documents WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (doc.project_id) {
    const access = hasProjectAccess(req.user, doc.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (doc.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(doc.id);
  db.prepare('DELETE FROM research_documents WHERE id = ?').run(doc.id);
  res.json({ ok: true });
});

// ==========================================
// 12. COLLABORATION (MEMBERS, COMMENTS, ACTIVITY)
// ==========================================
app.get('/api/collaboration/users', requireAuth, (_req: Request, res: Response) => {
  const users = db.prepare('SELECT id, email, name, role, title, institution, created_at FROM users').all();
  res.json({ users });
});

app.post('/api/collaboration/projects/:projectId/members', requireAuth, (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const access = hasProjectAccess(req.user, projectId, 'principal_investigator');
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  const { email, role } = req.body ?? {};
  const targetUser = db.prepare('SELECT id, name, email FROM users WHERE lower(email) = lower(?)').get(String(email || '').trim()) as
    | { id: string; name: string; email: string }
    | undefined;
  if (!targetUser) return res.status(404).json({ error: 'Researcher email not found in directory.' });

  const validRoles: CureRole[] = ['administrator', 'principal_investigator', 'researcher', 'reviewer', 'read_only'];
  const assigned: CureRole = validRoles.includes(role) ? role : 'researcher';
  db.prepare(
    `INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`
  ).run(newId('pm'), projectId, targetUser.id, assigned);

  writeAuditLog({
    userId: req.user!.id,
    projectId,
    action: 'project_member_updated',
    entityType: 'project_member',
    entityId: targetUser.id,
    details: { email: targetUser.email, role: assigned },
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

app.delete('/api/collaboration/projects/:projectId/members/:userId', requireAuth, (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const targetUserId = String(req.params.userId);
  const access = hasProjectAccess(req.user, projectId, 'principal_investigator');
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  const proj = db.prepare('SELECT owner_id FROM research_projects WHERE id = ?').get(projectId) as
    | { owner_id: string }
    | undefined;
  if (!proj) return res.status(404).json({ error: 'Project not found.' });
  if (proj.owner_id === targetUserId) {
    return res.status(400).json({ error: 'Cannot remove project owner.' });
  }
  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, targetUserId);
  writeAuditLog({
    userId: req.user!.id,
    projectId,
    action: 'project_member_removed',
    entityType: 'project_member',
    entityId: targetUserId,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

app.get('/api/collaboration/projects/:projectId/comments', requireAuth, (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const access = hasProjectAccess(req.user, projectId, 'read_only');
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  const comments = db
    .prepare(
      `SELECT c.*, u.name as author_name, u.role as author_role FROM collaboration_comments c
       JOIN users u ON u.id = c.user_id WHERE c.project_id = ? ORDER BY c.created_at DESC`
    )
    .all(projectId);
  res.json({ comments });
});

app.post('/api/collaboration/projects/:projectId/comments', requireAuth, (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const access = hasProjectAccess(req.user, projectId, 'reviewer');
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  const { target_type, target_id, content } = req.body ?? {};
  if (!content) return res.status(400).json({ error: 'Comment content is required.' });
  const id = newId('cmt');
  db.prepare(
    'INSERT INTO collaboration_comments (id, project_id, user_id, target_type, target_id, content) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, req.user!.id, target_type || 'project', target_id || projectId, String(content).trim());
  const comment = db
    .prepare(
      `SELECT c.*, u.name as author_name, u.role as author_role FROM collaboration_comments c
       JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(id);
  broadcastToProjectRoom(projectId, { type: 'comment:created', comment });
  res.status(201).json({ comment });
});

app.delete('/api/collaboration/projects/:projectId/comments/:commentId', requireAuth, (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const commentId = String(req.params.commentId);
  const access = hasProjectAccess(req.user, projectId, 'read_only');
  if (!access.allowed) return res.status(403).json({ error: access.reason });

  const cmt = db
    .prepare('SELECT id, user_id FROM collaboration_comments WHERE id = ? AND project_id = ?')
    .get(commentId, projectId) as { id: string; user_id: string } | undefined;
  if (!cmt) return res.status(404).json({ error: 'Comment not found.' });

  const isPrivileged =
    cmt.user_id === req.user!.id ||
    access.effectiveRole === 'principal_investigator' ||
    access.effectiveRole === 'administrator' ||
    req.user!.role === 'administrator';
  if (!isPrivileged) return res.status(403).json({ error: 'Only the author, PI, or administrator can remove review notes.' });

  db.prepare('DELETE FROM collaboration_comments WHERE id = ?').run(cmt.id);
  broadcastToProjectRoom(projectId, { type: 'comment:deleted', commentId: cmt.id });
  res.json({ ok: true });
});

// ==========================================
// 13. SYSTEM INTELLIGENCE & EVALUATIONS
// ==========================================
app.get('/api/system/health', requireAuth, async (_req: Request, res: Response) => {
  try {
    const literatureProbes = await probeLiteratureApis();
    const dbSizeBytes = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
    const jobs = db.prepare('SELECT * FROM analysis_jobs ORDER BY created_at DESC LIMIT 20').all();
    const tokenStats = db
      .prepare(
        `SELECT COUNT(*) as total_messages, COALESCE(SUM(tokens_used), 0) as total_tokens, COALESCE(AVG(latency_ms), 0) as avg_latency_ms
         FROM research_messages WHERE role = 'assistant'`
      )
      .get() as { total_messages: number; total_tokens: number; avg_latency_ms: number };
    const evaluations = db.prepare('SELECT * FROM model_evaluations ORDER BY created_at DESC LIMIT 20').all();
    const geminiClient = getGeminiClient();

    res.json({
      gemini: {
        configured: Boolean(geminiClient),
        activeModel: getSetting('gemini_model', 'gemini-4-hydrogen'),
        totalResponses: tokenStats.total_messages,
        totalTokens: tokenStats.total_tokens,
        avgLatencyMs: Math.round(tokenStats.avg_latency_ms),
      },
      database: {
        engine: 'SQLite WAL',
        sizeBytes: dbSizeBytes,
        status: 'healthy',
      },
      literatureApis: literatureProbes,
      jobs,
      evaluations,
    });
  } catch (err) {
    res.status(500).json({
      error: 'System health diagnostics failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/api/system/evaluate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { projectId, claimText } = req.body ?? {};
    if (!claimText) return res.status(400).json({ error: 'Text or hypothesis to evaluate is required.' });
    const scopedProjectId = projectId ? String(projectId) : null;
    if (scopedProjectId) {
      const access = hasProjectAccess(req.user, scopedProjectId, 'read_only');
      if (!access.allowed) return res.status(403).json({ error: access.reason });
    }
    const knownCitations = scopedProjectId
      ? (db
          .prepare('SELECT external_id as identifier, title, abstract FROM literature_sources WHERE project_id = ? LIMIT 15')
          .all(scopedProjectId) as Array<{ identifier: string; title: string; abstract: string }>)
      : [];
    const model = getSetting('gemini_model', 'gemini-4-hydrogen');
    const out = await evaluateResearchOutput({ model, claimText, knownCitations });
    const evalId = newId('eval');
    db.prepare(
      `INSERT INTO model_evaluations (id, project_id, evaluation_type, citation_verified, consistency_score, unsupported_claims_json, contradictory_notes, evaluator_notes)
       VALUES (?, ?, 'scientific_consistency_audit', ?, ?, ?, ?, ?)`
    ).run(
      evalId,
      projectId || null,
      out.evaluation.citation_verified ? 1 : 0,
      out.evaluation.consistency_score ?? null,
      JSON.stringify(out.evaluation.unsupported_claims ?? []),
      out.evaluation.contradictory_notes || '',
      out.evaluation.reproducibility_assessment || ''
    );
    res.json({ evaluationId: evalId, ...out });
  } catch (err) {
    res.status(500).json({ error: 'Evaluation workflow error', message: err instanceof Error ? err.message : String(err) });
  }
});

// ==========================================
// 14. SCIENTIFIC REPORT GENERATOR PAYLOAD
// ==========================================
app.get('/api/reports/project/:projectId', requireAuth, (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const access = hasProjectAccess(req.user, projectId, 'read_only');
  if (!access.allowed) return res.status(403).json({ error: access.reason });

  const project = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(projectId);
  const literature = db.prepare('SELECT * FROM literature_sources WHERE project_id = ?').all(projectId);
  const datasets = db.prepare('SELECT * FROM research_datasets WHERE project_id = ?').all(projectId);
  const hypotheses = db.prepare('SELECT * FROM research_hypotheses WHERE project_id = ?').all(projectId);
  const evidence = db
    .prepare(
      `SELECT he.* FROM hypothesis_evidence he
       JOIN research_hypotheses rh ON rh.id = he.hypothesis_id
       WHERE rh.project_id = ?`
    )
    .all(projectId);
  const experiments = db.prepare('SELECT * FROM experiment_plans WHERE project_id = ?').all(projectId);
  const conversations = db.prepare('SELECT * FROM research_conversations WHERE project_id = ?').all(projectId);
  const messages = db
    .prepare(
      `SELECT rm.* FROM research_messages rm
       JOIN research_conversations rc ON rc.id = rm.conversation_id
       WHERE rc.project_id = ? AND rm.role = 'assistant' ORDER BY rm.created_at DESC LIMIT 10`
    )
    .all(projectId);
  const jobs = db.prepare('SELECT * FROM analysis_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 15').all(projectId);
  const simulations = db
    .prepare(
      `SELECT sr.id, sr.scenario_name, sr.treatment_mechanism, sr.concentration_uM, sr.seed,
              sr.final_metrics_json, sr.summary_confidence,
              COALESCE(mv.version_tag, sr.model_version_id) as model_version_tag, sr.created_at
       FROM simulation_runs sr
       LEFT JOIN model_versions mv ON mv.id = sr.model_version_id
       WHERE sr.project_id = ?
       ORDER BY sr.created_at DESC LIMIT 20`
    )
    .all(projectId);
  const cyclesRaw = db
    .prepare('SELECT * FROM autonomous_cycles WHERE project_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(projectId) as Array<{ id: string }>;
  const autonomousCycles = cyclesRaw.map((cyc) => ({
    ...cyc,
    iterations: db
      .prepare(
        'SELECT iteration_number, criterion_passed, predicted_viability_end, confidence_score, evaluation_notes, failure_diagnosis, strategy_revision FROM autonomous_iterations WHERE cycle_id = ? ORDER BY iteration_number ASC'
      )
      .all(cyc.id),
  }));

  writeAuditLog({
    userId: req.user!.id,
    projectId,
    action: 'scientific_report_compiled',
    entityType: 'research_project',
    entityId: projectId,
    ipAddress: req.ip,
  });

  res.json({
    generatedAt: new Date().toISOString(),
    generatedBy: req.user!.name,
    project,
    literature,
    datasets,
    hypotheses,
    evidence,
    experiments,
    conversations,
    aiFindings: messages,
    computationalJobs: jobs,
    simulations,
    autonomousCycles,
  });
});

// ==========================================
// 15. SETTINGS & PRIVACY / DATA GOVERNANCE
// ==========================================
app.get('/api/settings', requireAuth, (req: Request, res: Response) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all();
  const isPrivileged = req.user!.role === 'administrator' || req.user!.role === 'principal_investigator';
  let auditLogs: unknown[];
  if (isPrivileged) {
    auditLogs = db
      .prepare(
        `SELECT a.*, u.name as actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC LIMIT 40`
      )
      .all();
  } else {
    const accessibleIds = listAccessibleProjectIds(req.user);
    if (accessibleIds.length > 0) {
      const ph = accessibleIds.map(() => '?').join(',');
      auditLogs = db
        .prepare(
          `SELECT a.*, u.name as actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.user_id = ? OR a.project_id IN (${ph})
           ORDER BY a.created_at DESC LIMIT 40`
        )
        .all(req.user!.id, ...accessibleIds);
    } else {
      auditLogs = db
        .prepare(
          `SELECT a.*, u.name as actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.user_id = ?
           ORDER BY a.created_at DESC LIMIT 40`
        )
        .all(req.user!.id);
    }
  }
  res.json({ settings: rows, auditLogs });
});

app.put('/api/settings', requireAuth, (req: Request, res: Response) => {
  if (req.user!.role === 'read_only') {
    return res.status(403).json({ error: 'Read-only collaborators cannot modify system governance settings.' });
  }
  const {
    gemini_model,
    data_retention_days,
    allow_external_literature_grounding,
    autonomous_max_iterations_cap,
    physician_review_confidence_threshold,
  } = req.body ?? {};
  const upsert = db.prepare(
    "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  );
  if (gemini_model) upsert.run('gemini_model', String(gemini_model));
  if (data_retention_days) upsert.run('data_retention_days', String(data_retention_days));
  if (allow_external_literature_grounding !== undefined) {
    upsert.run('allow_external_literature_grounding', String(Boolean(allow_external_literature_grounding)));
  }
  if (autonomous_max_iterations_cap !== undefined) {
    const cap = Math.max(1, Math.min(10, Math.round(Number(autonomous_max_iterations_cap) || 6)));
    upsert.run('autonomous_max_iterations_cap', String(cap));
  }
  if (physician_review_confidence_threshold !== undefined) {
    // Safety guardrail: physician review threshold cannot be bypassed below 0.90
    const rawT = Number(physician_review_confidence_threshold);
    const clampedT = Number.isFinite(rawT) ? Math.max(0.9, Math.min(0.99, rawT)) : 0.95;
    upsert.run('physician_review_confidence_threshold', clampedT.toFixed(2));
  }
  writeAuditLog({
    userId: req.user!.id,
    action: 'settings_updated',
    entityType: 'system_settings',
    details: req.body,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

app.get('/api/settings/export-user-data', requireAuth, (req: Request, res: Response) => {
  const uid = req.user!.id;
  res.json({
    exportedAt: new Date().toISOString(),
    user: req.user,
    projects: db.prepare('SELECT * FROM research_projects WHERE owner_id = ?').all(uid),
    literature: db.prepare('SELECT * FROM literature_sources WHERE user_id = ?').all(uid),
    hypotheses: db.prepare('SELECT * FROM research_hypotheses WHERE user_id = ?').all(uid),
    experiments: db.prepare('SELECT * FROM experiment_plans WHERE user_id = ?').all(uid),
    documents: db.prepare('SELECT * FROM research_documents WHERE user_id = ?').all(uid),
  });
});

// ==========================================
// 16. BIOLOGICAL SIMULATION & AUTONOMOUS INTELLIGENCE ENGINE
// ==========================================
app.get('/api/simulations', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId && !hasProjectAccess(req.user, projectId).allowed) {
    return res.status(403).json({ error: 'Access denied to this project.' });
  }
  const rows = projectId
    ? db
        .prepare('SELECT * FROM simulation_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 30')
        .all(projectId)
    : db
        .prepare('SELECT * FROM simulation_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
        .all(req.user!.id);
  const activeModel = getActiveModelVersion();
  res.json({ simulations: rows, activeModel });
});

app.get('/api/simulations/:id', requireAuth, (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM simulation_runs WHERE id = ?').get(req.params.id) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Simulation run not found.' });
  if (row.project_id && !hasProjectAccess(req.user, row.project_id).allowed) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  if (!row.project_id && row.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Access denied.' });
  }
  res.json({ simulation: row });
});

app.delete('/api/simulations/:id', requireAuth, (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM simulation_runs WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Simulation run not found.' });
  if (row.project_id) {
    const access = hasProjectAccess(req.user, row.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (row.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Access denied.' });
  }
  db.prepare('DELETE FROM simulation_runs WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

app.post('/api/simulations/run', requireAuth, (req: Request, res: Response) => {
  const {
    project_id,
    hypothesis_id,
    scenario_name,
    treatment_agent,
    treatment_mechanism,
    concentration_uM,
    initial_cancer_cells,
    initial_healthy_cells,
    resistance_factor,
    duration_hours,
    seed,
    dosing_schedule,
    half_life_hours,
    secondary_agent,
    secondary_mechanism,
    secondary_concentration_uM,
    resistant_subclone_fraction,
  } = req.body ?? {};

  const projectId = project_id ? String(project_id) : null;
  if (projectId && !hasProjectAccess(req.user, projectId, 'researcher').allowed) {
    return res.status(403).json({ error: 'Write access required for project simulations.' });
  }

  try {
    const out = runAndPersistSimulation({
      userId: req.user!.id,
      projectId,
      hypothesisId: hypothesis_id ? String(hypothesis_id) : null,
      scenarioName: scenario_name ? String(scenario_name) : undefined,
      treatmentAgent: treatment_agent ? String(treatment_agent) : undefined,
      treatmentMechanism: treatment_mechanism || 'targeted_kinase_inhibitor',
      concentrationUM: Number(concentration_uM ?? 2.5),
      initialCancerCells: Number(initial_cancer_cells ?? 42),
      initialHealthyCells: Number(initial_healthy_cells ?? 16),
      resistanceFactor: Number(resistance_factor ?? 0.25),
      durationHours: Number(duration_hours ?? 72),
      seed: Number(seed ?? 104729),
      dosingSchedule: (dosing_schedule as DosingSchedule) || 'continuous',
      halfLifeHours: half_life_hours !== undefined ? Number(half_life_hours) : 18,
      secondaryAgent: secondary_agent ? String(secondary_agent) : undefined,
      secondaryMechanism: (secondary_mechanism as TreatmentMechanism | 'none') || 'none',
      secondaryConcentrationUM: secondary_concentration_uM !== undefined ? Number(secondary_concentration_uM) : 0,
      resistantSubcloneFraction: resistant_subclone_fraction !== undefined ? Number(resistant_subclone_fraction) : 0.2,
      ipAddress: req.ip,
    });
    const saved = db.prepare('SELECT * FROM simulation_runs WHERE id = ?').get(out.id);
    res.status(201).json({ simulation: saved, result: out.result, modelVersionTag: out.modelVersionTag });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Simulation execution failed.' });
  }
});

app.get('/api/autonomous/cycles', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId && !hasProjectAccess(req.user, projectId).allowed) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  const cycles = (
    projectId
      ? db.prepare('SELECT * FROM autonomous_cycles WHERE project_id = ? ORDER BY created_at DESC LIMIT 20').all(projectId)
      : db.prepare('SELECT * FROM autonomous_cycles WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user!.id)
  ) as Array<{ id: string }>;

  const iterStmt = db.prepare(
    'SELECT * FROM autonomous_iterations WHERE cycle_id = ? ORDER BY iteration_number ASC'
  );
  const enriched = cycles.map((c) => ({
    ...c,
    iterations: iterStmt.all(c.id),
  }));
  res.json({ cycles: enriched });
});

app.post('/api/autonomous/cycles/start', requireAuth, async (req: Request, res: Response) => {
  const {
    project_id,
    goal_prompt,
    cancer_area,
    treatment_focus,
    execution_mode,
    max_iterations,
    initial_concentration_uM,
    initial_resistance_factor,
    allow_reproducibility_test,
  } = req.body ?? {};

  if (!goal_prompt || String(goal_prompt).trim().length < 6) {
    return res.status(400).json({ error: 'Provide a clear scientific research goal (>= 6 characters).' });
  }
  const projectId = project_id ? String(project_id) : null;
  if (projectId && !hasProjectAccess(req.user, projectId, 'researcher').allowed) {
    return res.status(403).json({ error: 'Write access required to run autonomous cycles on this project.' });
  }

  try {
    const maxCap = Math.max(1, Math.min(10, Number(getSetting('autonomous_max_iterations_cap', '6')) || 6));
    const boundedIterations = Math.max(1, Math.min(maxCap, Number(max_iterations ?? 3)));
    const { cycleId } = await runAutonomousResearchCycle({
      userId: req.user!.id,
      projectId,
      goalPrompt: String(goal_prompt).trim(),
      cancerArea: String(cancer_area || ''),
      treatmentFocus: treatment_focus || 'targeted_kinase_inhibitor',
      executionMode: execution_mode === 'computational_calibration' ? 'computational_calibration' : 'ai_guided',
      maxIterations: boundedIterations,
      initialConcentrationUM: Number(initial_concentration_uM ?? 2.0),
      initialResistanceFactor: Number(initial_resistance_factor ?? 0.32),
      allowReproducibilityTest: Boolean(allow_reproducibility_test),
      geminiModel: getSetting('gemini_model', 'gemini-4-hydrogen'),
      ipAddress: req.ip,
    });

    const cycle = db.prepare('SELECT * FROM autonomous_cycles WHERE id = ?').get(cycleId) as Record<string, unknown>;
    const iterations = db
      .prepare('SELECT * FROM autonomous_iterations WHERE cycle_id = ? ORDER BY iteration_number ASC')
      .all(cycleId);
    res.status(201).json({ cycle: { ...cycle, iterations } });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Autonomous intelligence cycle failed.',
    });
  }
});

app.post('/api/autonomous/cycles/stream', requireAuth, async (req: Request, res: Response) => {
  const {
    project_id,
    goal_prompt,
    cancer_area,
    treatment_focus,
    execution_mode,
    max_iterations,
    initial_concentration_uM,
    initial_resistance_factor,
    allow_reproducibility_test,
  } = req.body ?? {};

  if (!goal_prompt || String(goal_prompt).trim().length < 6) {
    return res.status(400).json({ error: 'Provide a clear scientific research goal (>= 6 characters).' });
  }
  const projectId = project_id ? String(project_id) : null;
  if (projectId && !hasProjectAccess(req.user, projectId, 'researcher').allowed) {
    return res.status(403).json({ error: 'Write access required to run autonomous cycles on this project.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  try {
    const maxCap = Math.max(1, Math.min(10, Number(getSetting('autonomous_max_iterations_cap', '6')) || 6));
    const boundedIterations = Math.max(1, Math.min(maxCap, Number(max_iterations ?? 3)));
    const { cycleId } = await runAutonomousResearchCycle({
      userId: req.user!.id,
      projectId,
      goalPrompt: String(goal_prompt).trim(),
      cancerArea: String(cancer_area || ''),
      treatmentFocus: treatment_focus || 'targeted_kinase_inhibitor',
      executionMode: execution_mode === 'computational_calibration' ? 'computational_calibration' : 'ai_guided',
      maxIterations: boundedIterations,
      initialConcentrationUM: Number(initial_concentration_uM ?? 2.0),
      initialResistanceFactor: Number(initial_resistance_factor ?? 0.32),
      allowReproducibilityTest: Boolean(allow_reproducibility_test),
      geminiModel: getSetting('gemini_model', 'gemini-4-hydrogen'),
      ipAddress: req.ip,
      onProgress: (evt) => {
        writeSseEvent(res, evt.type, evt);
      },
    });

    const cycle = db.prepare('SELECT * FROM autonomous_cycles WHERE id = ?').get(cycleId) as Record<string, unknown>;
    const iterations = db
      .prepare('SELECT * FROM autonomous_iterations WHERE cycle_id = ? ORDER BY iteration_number ASC')
      .all(cycleId);
    writeSseEvent(res, 'complete', { cycle: { ...cycle, iterations } });
    res.end();
  } catch (err) {
    writeSseEvent(res, 'error', {
      message: err instanceof Error ? err.message : 'Autonomous intelligence cycle failed.',
    });
    res.end();
  }
});

app.delete('/api/autonomous/cycles/:id', requireAuth, (req: Request, res: Response) => {
  const cyc = db.prepare('SELECT * FROM autonomous_cycles WHERE id = ?').get(String(req.params.id)) as
    | { id: string; project_id: string | null; user_id: string }
    | undefined;
  if (!cyc) return res.status(404).json({ error: 'Autonomous cycle not found.' });
  if (cyc.project_id) {
    const access = hasProjectAccess(req.user, cyc.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (cyc.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM autonomous_iterations WHERE cycle_id = ?').run(cyc.id);
  db.prepare('DELETE FROM autonomous_cycles WHERE id = ?').run(cyc.id);
  res.json({ ok: true });
});

app.post('/api/autonomous/iterations/:id/reproduce', requireAuth, (req: Request, res: Response) => {
  const iter = db
    .prepare(
      `SELECT it.*, cyc.project_id, cyc.user_id FROM autonomous_iterations it
       JOIN autonomous_cycles cyc ON cyc.id = it.cycle_id
       WHERE it.id = ?`
    )
    .get(String(req.params.id)) as
    | {
        id: string;
        cycle_id: string;
        iteration_number: number;
        project_id: string | null;
        user_id: string;
        hypothesis_id: string | null;
        simulation_run_id: string | null;
        predicted_viability_end: number | null;
      }
    | undefined;
  if (!iter) return res.status(404).json({ error: 'Iteration record not found.' });
  if (iter.project_id) {
    const access = hasProjectAccess(req.user, iter.project_id, 'researcher');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  } else if (iter.user_id !== req.user!.id && req.user!.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const origRun = iter.simulation_run_id
    ? (db.prepare('SELECT * FROM simulation_runs WHERE id = ?').get(iter.simulation_run_id) as
        | {
            scenario_name: string;
            treatment_agent: string;
            treatment_mechanism: string;
            concentration_uM: number;
            initial_cancer_cells: number;
            initial_healthy_cells: number;
            resistance_factor: number;
            duration_hours: number;
            seed: number;
            model_version_id: string;
            parameters_json: string;
          }
        | undefined)
    : undefined;
  if (!origRun) {
    return res.status(400).json({ error: 'No persisted simulation run linked to this iteration.' });
  }

  let origParsedParams: {
    calibration?: Record<string, number>;
    dosingSchedule?: DosingSchedule;
    halfLifeHours?: number;
    secondaryAgent?: string;
    secondaryMechanism?: TreatmentMechanism | 'none';
    secondaryConcentrationUM?: number;
    resistantSubcloneFraction?: number;
  } = {};
  try {
    origParsedParams = JSON.parse(origRun.parameters_json) as typeof origParsedParams;
  } catch {
    origParsedParams = {};
  }

  const origModelRow = db
    .prepare('SELECT version_tag FROM model_versions WHERE id = ?')
    .get(origRun.model_version_id) as { version_tag: string } | undefined;

  const reproOut = runAndPersistSimulation({
    userId: req.user!.id,
    projectId: iter.project_id,
    hypothesisId: iter.hypothesis_id,
    scenarioName: `REPRODUCIBILITY TEST · ${origRun.scenario_name}`,
    treatmentAgent: origRun.treatment_agent,
    treatmentMechanism: origRun.treatment_mechanism as TreatmentMechanism,
    concentrationUM: origRun.concentration_uM,
    initialCancerCells: origRun.initial_cancer_cells,
    initialHealthyCells: origRun.initial_healthy_cells,
    resistanceFactor: origRun.resistance_factor,
    durationHours: origRun.duration_hours,
    seed: origRun.seed,
    dosingSchedule: origParsedParams.dosingSchedule,
    halfLifeHours: origParsedParams.halfLifeHours,
    secondaryAgent: origParsedParams.secondaryAgent,
    secondaryMechanism: origParsedParams.secondaryMechanism,
    secondaryConcentrationUM: origParsedParams.secondaryConcentrationUM,
    resistantSubcloneFraction: origParsedParams.resistantSubcloneFraction,
    calibrationOverride: origParsedParams.calibration,
    modelVersionIdOverride: origRun.model_version_id,
    ipAddress: req.ip,
  });

  const deltaViability = Math.abs(reproOut.result.finalMetrics.cellViabilityPct - (iter.predicted_viability_end ?? 0));
  const deterministicMatch = deltaViability < 0.05;
  const replayTag = origModelRow?.version_tag || reproOut.modelVersionTag;
  const sig = `${reproOut.result.signatureHash}-repro-${replayTag}`;

  db.prepare(
    `INSERT INTO research_memory (
      id, project_id, user_id, memory_type, experiment_signature_hash, title, parameters_json, outcome_status, confidence_score, rationale, references_json, model_version
     ) VALUES (?, ?, ?, 'model_calibration', ?, ?, ?, 'reproducibility_test', ?, ?, ?, ?)`
  ).run(
    newId('mem'),
    iter.project_id,
    req.user!.id,
    sig,
    `Reproducibility Verification (Iter ${iter.iteration_number})`,
    JSON.stringify({
      mechanism: origRun.treatment_mechanism,
      concentration_uM: origRun.concentration_uM,
      resistance_factor: origRun.resistance_factor,
      seed: origRun.seed,
      model_version: replayTag,
    }),
    reproOut.result.finalMetrics.evidenceSupportedConfidence,
    `Deterministic seed=${origRun.seed} replay (${replayTag}): delta viability=${deltaViability.toFixed(3)}% (${deterministicMatch ? 'EXACT DETERMINISTIC MATCH' : 'MODEL VERSION DIVERGENCE LOGGED'}).`,
    JSON.stringify([`SIM:${reproOut.id}`]),
    replayTag
  );

  res.status(201).json({
    reproducibilitySimulationId: reproOut.id,
    deterministicMatch,
    deltaViabilityPct: Number(deltaViability.toFixed(3)),
    reproducedViabilityEnd: reproOut.result.finalMetrics.cellViabilityPct,
    modelVersionTag: replayTag,
  });
});

app.get('/api/autonomous/memory', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId && !hasProjectAccess(req.user, projectId).allowed) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  const memory = projectId
    ? db.prepare('SELECT * FROM research_memory WHERE project_id = ? ORDER BY created_at DESC LIMIT 60').all(projectId)
    : db.prepare('SELECT * FROM research_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 60').all(req.user!.id);
  res.json({ memory });
});

app.get('/api/autonomous/models', requireAuth, (_req: Request, res: Response) => {
  const models = db.prepare('SELECT * FROM model_versions ORDER BY created_at DESC LIMIT 30').all();
  res.json({ models });
});

app.post('/api/autonomous/models/:id/rollback', requireAuth, (req: Request, res: Response) => {
  if (!['administrator', 'principal_investigator', 'researcher'].includes(req.user!.role)) {
    return res.status(403).json({ error: 'Insufficient privileges to roll back simulation model version.' });
  }
  const target = db.prepare('SELECT * FROM model_versions WHERE id = ?').get(req.params.id) as
    | { id: string; version_tag: string; protected_guardrails_intact: number }
    | undefined;
  if (!target) return res.status(404).json({ error: 'Model version not found.' });

  db.prepare('UPDATE model_versions SET is_active = 0').run();
  db.prepare("UPDATE model_versions SET is_active = 1, rolled_back_at = datetime('now') WHERE id = ?").run(target.id);

  writeAuditLog({
    userId: req.user!.id,
    action: 'model_version_rolled_back',
    entityType: 'model_version',
    entityId: target.id,
    details: { restoredVersionTag: target.version_tag, guardrailsIntact: true },
    ipAddress: req.ip,
  });

  const models = db.prepare('SELECT * FROM model_versions ORDER BY created_at DESC LIMIT 30').all();
  res.json({ ok: true, activeModelId: target.id, models });
});

app.get('/api/validation/queue', requireAuth, (req: Request, res: Response) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  if (projectId && !hasProjectAccess(req.user, projectId).allowed) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  let items: unknown[];
  if (projectId) {
    items = db
      .prepare('SELECT * FROM physician_validation_queue WHERE project_id = ? ORDER BY created_at DESC LIMIT 40')
      .all(projectId);
  } else if (req.user!.role === 'administrator') {
    items = db.prepare('SELECT * FROM physician_validation_queue ORDER BY created_at DESC LIMIT 40').all();
  } else {
    const accessibleIds = listAccessibleProjectIds(req.user);
    if (accessibleIds.length > 0) {
      const ph = accessibleIds.map(() => '?').join(',');
      items = db
        .prepare(
          `SELECT * FROM physician_validation_queue
           WHERE project_id IS NULL OR project_id IN (${ph})
           ORDER BY created_at DESC LIMIT 40`
        )
        .all(...accessibleIds);
    } else {
      items = db
        .prepare('SELECT * FROM physician_validation_queue WHERE project_id IS NULL ORDER BY created_at DESC LIMIT 40')
        .all();
    }
  }
  res.json({ items });
});

app.post('/api/validation/queue/:id/review', requireAuth, (req: Request, res: Response) => {
  if (!['administrator', 'principal_investigator', 'reviewer'].includes(req.user!.role)) {
    return res.status(403).json({
      error: 'Only certified reviewers, Principal Investigators, or administrators may adjudicate validation queue items.',
    });
  }
  const { validation_status, reviewer_credentials, review_notes } = req.body ?? {};
  const allowed = ['physician_approved', 'physician_rejected', 'revision_requested'];
  if (!allowed.includes(String(validation_status))) {
    return res.status(400).json({ error: 'Invalid validation status.' });
  }
  const item = db.prepare('SELECT * FROM physician_validation_queue WHERE id = ?').get(req.params.id) as
    | { id: string; project_id: string | null; hypothesis_id: string | null; title: string; summary: string }
    | undefined;
  if (!item) return res.status(404).json({ error: 'Validation queue item not found.' });
  if (item.project_id) {
    const access = hasProjectAccess(req.user, item.project_id, 'reviewer');
    if (!access.allowed) return res.status(403).json({ error: access.reason });
  }

  db.prepare(
    `UPDATE physician_validation_queue
     SET validation_status = ?, reviewer_user_id = ?, reviewer_name = ?, reviewer_credentials = ?, review_notes = ?, reviewed_at = datetime('now')
     WHERE id = ?`
  ).run(
    String(validation_status),
    req.user!.id,
    req.user!.name,
    String(reviewer_credentials || req.user!.title || 'Certified Oncology Reviewer').trim(),
    String(review_notes || '').trim(),
    item.id
  );

  if (validation_status === 'physician_approved' && item.hypothesis_id) {
    db.prepare("UPDATE research_hypotheses SET status = 'experimentally_proposed' WHERE id = ?").run(item.hypothesis_id);
  } else if (validation_status === 'physician_rejected' && item.hypothesis_id) {
    db.prepare("UPDATE research_hypotheses SET status = 'refuted' WHERE id = ?").run(item.hypothesis_id);
  }

  writeAuditLog({
    userId: req.user!.id,
    projectId: item.project_id,
    action: 'physician_validation_adjudicated',
    entityType: 'physician_validation_queue',
    entityId: item.id,
    details: { validation_status, reviewer: req.user!.name },
    ipAddress: req.ip,
  });

  const updated = db.prepare('SELECT * FROM physician_validation_queue WHERE id = ?').get(item.id);
  res.json({ item: updated });
});

// Explicit JSON 404 fallback for unknown /api/* routes (prevents SPA HTML fallthrough)
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Global error handler for multer/upload and JSON parse errors
app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message || 'Request failed' });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'))) {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/collaboration' });

  wss.on('connection', (ws, req) => {
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const projectId = parsedUrl.searchParams.get('projectId') || '';
      const user = extractUserFromTokenOrCookie(req.headers.cookie, req.headers.authorization);
      if (!user || !projectId) {
        ws.close(1008, 'Authentication and projectId required');
        return;
      }
      const access = hasProjectAccess(user, projectId, 'read_only');
      if (!access.allowed) {
        ws.close(1008, access.reason || 'Access denied');
        return;
      }

      if (!projectRooms.has(projectId)) {
        projectRooms.set(projectId, new Map());
      }
      const room = projectRooms.get(projectId)!;
      room.set(ws, user);

      broadcastToProjectRoom(projectId, {
        type: 'presence:state',
        projectId,
        users: getRoomUsersPayload(projectId),
      });

      const keepalive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 25000);

      ws.on('close', () => {
        clearInterval(keepalive);
        const activeRoom = projectRooms.get(projectId);
        if (activeRoom) {
          activeRoom.delete(ws);
          if (activeRoom.size === 0) {
            projectRooms.delete(projectId);
          } else {
            broadcastToProjectRoom(projectId, {
              type: 'presence:state',
              projectId,
              users: getRoomUsersPayload(projectId),
            });
          }
        }
      });

      ws.on('error', () => {
        clearInterval(keepalive);
      });
    } catch {
      ws.close(1011, 'WebSocket initialization failed');
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Project C.U.R.E. workstation running at http://0.0.0.0:${PORT} (WebSockets enabled on /ws/collaboration)`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down Project C.U.R.E. cleanly...`);
    wss.clients.forEach((client) => {
      try {
        client.close(1001, 'Server shutting down');
      } catch {
        // ignore
      }
    });
    wss.close();
    httpServer.close(() => {
      try {
        db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    });
    setTimeout(() => {
      try {
        db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    }, 4000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[Project C.U.R.E.] Unhandled promise rejection:', reason);
  });
}

startServer();
