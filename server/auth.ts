import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';

export type CureRole =
  | 'administrator'
  | 'principal_investigator'
  | 'researcher'
  | 'reviewer'
  | 'read_only';

const ROLE_WEIGHT: Record<CureRole, number> = {
  read_only: 1,
  reviewer: 2,
  researcher: 3,
  principal_investigator: 4,
  administrator: 5,
};

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'CHANGE_ME_IN_PRODUCTION'
    ? process.env.SESSION_SECRET
    : crypto.createHash('sha256').update(process.cwd() + '_cure_local_session_key').digest('hex');

export const SESSION_COOKIE_NAME = 'cure_session';

export interface AuthUser {
  id: string;
  org_id: string | null;
  email: string;
  name: string;
  role: CureRole;
  title: string;
  institution: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser | null;
    }
  }
}

export function signSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, iat: Date.now(), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.uid || typeof decoded.exp !== 'number' || decoded.exp < Date.now()) return null;
    return decoded.uid;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

export function extractUserFromTokenOrCookie(cookieHeader?: string, authHeader?: string): AuthUser | null {
  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(cookieHeader);
    token = cookies[SESSION_COOKIE_NAME];
  }
  if (!token) return null;
  const uid = verifySessionToken(token);
  if (!uid) return null;

  const user = db
    .prepare('SELECT id, org_id, email, name, role, title, institution FROM users WHERE id = ?')
    .get(uid) as AuthUser | undefined;
  return user ?? null;
}

export function extractUserFromRequest(req: Request): AuthUser | null {
  return extractUserFromTokenOrCookie(req.headers.cookie, req.headers.authorization);
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = extractUserFromRequest(req);
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = extractUserFromRequest(req);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please sign in as a qualified researcher to access or modify project records.',
    });
  }
  req.user = user;
  next();
}

export function hasProjectAccess(
  user: AuthUser | null | undefined,
  projectId: string,
  minRole: CureRole = 'read_only'
): { allowed: boolean; effectiveRole?: CureRole; reason?: string } {
  const project = db
    .prepare('SELECT id, org_id, owner_id, visibility FROM research_projects WHERE id = ?')
    .get(projectId) as
    | { id: string; org_id: string | null; owner_id: string; visibility: string }
    | undefined;

  if (!project) {
    return { allowed: false, reason: 'Project not found' };
  }

  if (!user) {
    if (project.visibility === 'public_read' && minRole === 'read_only') {
      return { allowed: true, effectiveRole: 'read_only' };
    }
    return { allowed: false, reason: 'Authentication required to access restricted project information.' };
  }

  if (user.role === 'administrator') {
    return { allowed: true, effectiveRole: 'administrator' };
  }

  if (project.owner_id === user.id) {
    return { allowed: true, effectiveRole: 'principal_investigator' };
  }

  const membership = db
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, user.id) as { role: CureRole } | undefined;

  if (membership) {
    if (ROLE_WEIGHT[membership.role] >= ROLE_WEIGHT[minRole]) {
      return { allowed: true, effectiveRole: membership.role };
    }
    return {
      allowed: false,
      reason: `Insufficient project permissions (${membership.role} cannot perform ${minRole} action).`,
    };
  }

  if (project.visibility === 'organisation' && project.org_id && project.org_id === user.org_id) {
    const orgRole: CureRole = ROLE_WEIGHT[user.role] >= ROLE_WEIGHT[minRole] ? user.role : 'read_only';
    if (ROLE_WEIGHT[orgRole] >= ROLE_WEIGHT[minRole]) {
      return { allowed: true, effectiveRole: orgRole };
    }
  }

  if (project.visibility === 'public_read' && minRole === 'read_only') {
    return { allowed: true, effectiveRole: 'read_only' };
  }

  return {
    allowed: false,
    reason: 'Access denied: you are not a member of this restricted research project.',
  };
}
