/** @fileoverview Authentication API route handlers. */

import type { Route } from '../http.ts';
import { pathToRegex, json, jsonError, readJsonBody } from '../http.ts';
import {
  getUserCount,
  getUserByEmail,
  getUserById,
  createUser,
  getSetting,
} from '../../db/index.ts';
import {
  hashPassword,
  verifyPassword,
  generateTokenKey,
  getOrCreateSecret,
  signToken,
  extractUserIdFromToken,
} from '../auth.ts';
import { isServiceUser } from '../service-user.ts';

export function buildAuthRoutes(): Route[] {
  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/auth/check'),
      skipAuth: true,
      handler(_req, res) {
        const count = getUserCount();
        json(res, {
          setupRequired: count === 0,
          authRequired: count > 0,
          onboardingRequired: count > 0 && getSetting('onboarding_completed') !== 'true',
        });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/auth/setup'),
      skipAuth: true,
      async handler(req, res) {
        if (getUserCount() > 0) {
          jsonError(res, 'Setup already completed', 403);
          return;
        }
        let body: { email?: string; password?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.email || typeof body.email !== 'string' || !body.email.trim()) {
          jsonError(res, '"email" is required', 400);
          return;
        }
        if (!body.password || typeof body.password !== 'string' || body.password.length < 8) {
          jsonError(res, 'Password must be at least 8 characters', 400);
          return;
        }
        const email = body.email.trim().toLowerCase();
        const passwordHash = await hashPassword(body.password);
        const tokenKey = generateTokenKey();
        const user = createUser(email, passwordHash, tokenKey);
        const secret = getOrCreateSecret();
        const token = signToken(user.id, tokenKey, secret);
        json(res, { token, user: { id: user.id, email: user.email } }, 201);
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/auth/login'),
      skipAuth: true,
      async handler(req, res) {
        let body: { email?: string; password?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.email || !body.password) {
          jsonError(res, 'Invalid credentials', 401);
          return;
        }
        const user = getUserByEmail(body.email.trim());
        if (!user) {
          jsonError(res, 'Invalid credentials', 401);
          return;
        }
        const valid = await verifyPassword(body.password, user.password_hash);
        if (!valid) {
          jsonError(res, 'Invalid credentials', 401);
          return;
        }
        const secret = getOrCreateSecret();
        const token = signToken(user.id, user.token_key, secret);
        json(res, { token, user: { id: user.id, email: user.email } });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/auth/verify'),
      handler(_req, res) {
        json(res, { valid: true });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/auth/me'),
      handler(req, res) {
        const authHeader = req.headers['authorization'] ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        const userId = token ? extractUserIdFromToken(token) : null;
        if (userId === null) {
          jsonError(res, 'No authenticated user', 401);
          return;
        }
        const user = getUserById(userId);
        if (!user) {
          jsonError(res, 'User not found', 404);
          return;
        }
        json(res, {
          id: user.id,
          email: user.email,
          isService: isServiceUser(user),
        });
      },
    },
  ];
}
