import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, pool } from '../../db';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const REFRESH_TOKEN_TTL_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Issue a new refresh token for a user. Returns the raw token (stored only once, then hashed).
export async function issueRefreshToken(userId: string, family?: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(token);
  const familyId = family ?? uuidv4();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, familyId, expiresAt]
  );

  return token;
}

// Rotate a refresh token. Returns { newToken, userId } on success.
// On reuse of an already-used token (theft signal), invalidates the entire family.
export async function rotateRefreshToken(rawToken: string): Promise<{ newToken: string; userId: string }> {
  const tokenHash = hashToken(rawToken);

  const rows = await query<{
    id: string;
    user_id: string;
    family: string;
    used: boolean;
    expires_at: Date;
  }>(
    `SELECT id, user_id, family, used, expires_at FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!rows.length) throw new Error('Invalid refresh token');
  const rt = rows[0];

  if (new Date(rt.expires_at) < new Date()) throw new Error('Refresh token expired');

  if (rt.used) {
    // Token reuse detected — this family may be compromised. Invalidate all tokens in family.
    await pool.query(`DELETE FROM refresh_tokens WHERE family = $1`, [rt.family]);
    logger.warn('Refresh token reuse detected — family invalidated', {
      user_id: rt.user_id,
      family: rt.family,
    });
    throw new Error('Token reuse detected. Please log in again.');
  }

  // Mark old token as used
  await pool.query(`UPDATE refresh_tokens SET used = true WHERE id = $1`, [rt.id]);

  // Issue new token in the same family
  const newToken = await issueRefreshToken(rt.user_id, rt.family);
  return { newToken, userId: rt.user_id };
}

// Revoke all tokens for a user (logout from all devices)
export async function revokeAllTokens(userId: string): Promise<void> {
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
}
