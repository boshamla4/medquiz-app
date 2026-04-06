import { v4 as uuidv4 } from 'uuid';
import db from './db';

interface SessionRow {
  id: string;
  user_id: number;
  is_active: number;
}

interface UserRow {
  id: number;
  active_session_id: string | null;
}

export function validateSession(
  sessionId: string
): { valid: boolean; userId: number; reason?: string } {
  const session = db
    .prepare('SELECT id, user_id, is_active FROM sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;

  if (!session) {
    return { valid: false, userId: 0, reason: 'SESSION_NOT_FOUND' };
  }

  if (!session.is_active) {
    return { valid: false, userId: 0, reason: 'SESSION_EXPIRED' };
  }

  const user = db
    .prepare('SELECT id, active_session_id FROM users WHERE id = ?')
    .get(session.user_id) as UserRow | undefined;

  if (!user) {
    return { valid: false, userId: 0, reason: 'USER_NOT_FOUND' };
  }

  if (user.active_session_id !== sessionId) {
    return { valid: false, userId: 0, reason: 'SESSION_HIJACKED' };
  }

  return { valid: true, userId: session.user_id };
}

export function createSession(
  userId: number,
  deviceInfo: Record<string, unknown>
): string {
  const sessionId = uuidv4();

  // Deactivate any existing sessions for this user
  db.prepare(
    'UPDATE sessions SET is_active = 0 WHERE user_id = ? AND is_active = 1'
  ).run(userId);

  db.prepare(
    `INSERT INTO sessions (id, user_id, started_at, last_seen, device_info, is_active)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 1)`
  ).run(sessionId, userId, JSON.stringify(deviceInfo));

  db.prepare('UPDATE users SET active_session_id = ? WHERE id = ?').run(
    sessionId,
    userId
  );

  return sessionId;
}

export function deactivateSession(sessionId: string): void {
  const session = db
    .prepare('SELECT user_id FROM sessions WHERE id = ?')
    .get(sessionId) as Pick<SessionRow, 'user_id'> | undefined;

  if (!session) return;

  db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(sessionId);

  db.prepare(
    'UPDATE users SET active_session_id = NULL WHERE id = ? AND active_session_id = ?'
  ).run(session.user_id, sessionId);
}

export function updateSessionLastSeen(sessionId: string): void {
  db.prepare('UPDATE sessions SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(
    sessionId
  );
}
