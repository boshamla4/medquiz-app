// lib/auth.ts — FULL REPLACEMENT
import { v4 as uuidv4 } from 'uuid';
import db from './db';

export async function validateSession(
  sessionId: string
): Promise<{ valid: boolean; userId: number; reason?: string }> {
  const { data: session } = await db
    .from('sessions')
    .select('id, user_id, is_active')
    .eq('id', sessionId)
    .single();

  if (!session) return { valid: false, userId: 0, reason: 'SESSION_NOT_FOUND' };
  if (!session.is_active) return { valid: false, userId: 0, reason: 'SESSION_EXPIRED' };

  const { data: user } = await db
    .from('users')
    .select('id, active_session_id')
    .eq('id', session.user_id)
    .single();

  if (!user) return { valid: false, userId: 0, reason: 'USER_NOT_FOUND' };
  if (user.active_session_id !== sessionId) {
    return { valid: false, userId: 0, reason: 'SESSION_HIJACKED' };
  }

  return { valid: true, userId: session.user_id };
}

export async function createSession(
  userId: number,
  deviceInfo: Record<string, unknown>
): Promise<string> {
  const sessionId = uuidv4();

  await db.from('sessions').update({ is_active: false }).eq('user_id', userId).eq('is_active', true);

  await db.from('sessions').insert({
    id: sessionId,
    user_id: userId,
    device_info: deviceInfo,
    is_active: true,
  });

  await db.from('users').update({ active_session_id: sessionId }).eq('id', userId);

  return sessionId;
}

export async function deactivateSession(sessionId: string): Promise<void> {
  const { data: session } = await db
    .from('sessions')
    .select('user_id')
    .eq('id', sessionId)
    .single();

  if (!session) return;

  await db.from('sessions').update({ is_active: false }).eq('id', sessionId);
  await db
    .from('users')
    .update({ active_session_id: null })
    .eq('id', session.user_id)
    .eq('active_session_id', sessionId);
}

export async function updateSessionLastSeen(sessionId: string): Promise<void> {
  await db.from('sessions').update({ last_seen: new Date().toISOString() }).eq('id', sessionId);
}
