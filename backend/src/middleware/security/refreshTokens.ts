import crypto from 'crypto';
import { query, pool } from '../../db';

const REFRESH_TOKEN_TTL_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function rotateRefreshToken(rawToken: string): Promise<{ newToken: string; userId: string }> {
  const tokenHash = hashToken(rawToken);

  const claimed = await query<{ user_id: string }>(
    `DELETE FROM refresh_tokens
      WHERE token_hash = $1 AND expires_at > now()
      RETURNING user_id`,
    [tokenHash]
  );

  if (!claimed.length) {
    throw new Error('Invalid, expired, or already-used refresh token');
  }

  const userId = claimed[0].user_id;
  const newToken = await issueRefreshToken(userId);
  return { newToken, userId };
}

export async function revokeAllTokens(userId: string): Promise<void> {
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
}
