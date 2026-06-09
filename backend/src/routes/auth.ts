import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, pool } from '../db';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { issueRefreshToken, rotateRefreshToken, revokeAllTokens } from '../middleware/security/refreshTokens';
import { authenticate } from '../middleware/auth';

const router = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

function signAccessToken(userId: string, email: string, role: string): string {
  return jwt.sign({ user_id: userId, email, role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

router.post('/register', async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password, name } = parsed.data;
  const hash = await bcrypt.hash(password, 12);

  try {
    const rows = await query<{ id: string; role: string }>(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4) RETURNING id, role`,
      [uuidv4(), email, hash, name]
    );
    const user = rows[0];
    const accessToken = signAccessToken(user.id, email, user.role);
    const refreshToken = await issueRefreshToken(user.id);
    res.status(201).json({ accessToken, refreshToken, user: { id: user.id, email, name, role: user.role } });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    throw err;
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;
  const rows = await query<{
    id: string; password_hash: string; name: string; role: string;
    failed_logins: number; locked_until: Date | null;
  }>(
    `SELECT id, password_hash, name, role, failed_logins, locked_until FROM users WHERE email = $1`,
    [email]
  );

  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
  const user = rows[0];

  // Account lockout check
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(423).json({ error: 'Account temporarily locked. Please try again later.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const incremented = await pool.query<{ failed_logins: number }>(
      `UPDATE users
          SET failed_logins = failed_logins + 1,
              locked_until = CASE
                WHEN failed_logins + 1 >= $1 THEN now() + ($2 || ' minutes')::interval
                ELSE locked_until
              END
        WHERE id = $3
        RETURNING failed_logins`,
      [MAX_FAILED_LOGINS, LOCKOUT_MINUTES.toString(), user.id]
    );

    const newFailCount = incremented.rows[0]?.failed_logins ?? 0;
    if (newFailCount >= MAX_FAILED_LOGINS) {
      return res.status(401).json({ error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Reset failed login counter on success
  await pool.query(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [user.id]);

  const accessToken = signAccessToken(user.id, email, user.role);
  const refreshToken = await issueRefreshToken(user.id);
  res.json({ accessToken, refreshToken, user: { id: user.id, email, name: user.name, role: user.role } });
});

router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  try {
    const { newToken, userId } = await rotateRefreshToken(refreshToken);
    const users = await query<{ email: string; role: string }>(
      `SELECT email, role FROM users WHERE id = $1`, [userId]
    );
    if (!users.length) return res.status(401).json({ error: 'User not found' });
    const { email, role } = users[0];
    const accessToken = signAccessToken(userId, email, role);
    res.json({ accessToken, refreshToken: newToken });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

router.post('/logout', authenticate, async (req: Request, res: Response) => {
  await revokeAllTokens(req.user!.user_id);
  res.json({ message: 'Logged out from all devices' });
});

export default router;
