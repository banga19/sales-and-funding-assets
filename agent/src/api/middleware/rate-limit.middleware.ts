/**
 * rate-limit.middleware.ts
 *
 * Express rate limiter with per-endpoint and per-IP tracking.
 * Uses in-memory store (swap for Redis in production).
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

interface RateLimitConfig {
  windowMs: number;    // Time window in milliseconds
  max: number;         // Max requests per window
  message?: string;    // Custom error message
  keyPrefix?: string;  // Key prefix for tracking
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store (use Redis for multi-instance deployments)
const store = new Map<string, RateLimitEntry>();

// Cleanup interval (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

export function rateLimit(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${config.keyPrefix || 'rl'}:${ip}`;
    const now = Date.now();

    let entry = store.get(key);

    // Reset expired entry
    if (entry && entry.resetAt < now) {
      store.delete(key);
      entry = undefined;
    }

    // First request in window
    if (!entry) {
      entry = { count: 1, resetAt: now + config.windowMs };
      store.set(key, entry);
      res.set('X-RateLimit-Limit', String(config.max));
      res.set('X-RateLimit-Remaining', String(config.max - 1));
      res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
      next();
      return;
    }

    // Within limit
    if (entry.count < config.max) {
      entry.count++;
      res.set('X-RateLimit-Limit', String(config.max));
      res.set('X-RateLimit-Remaining', String(config.max - entry.count));
      res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
      next();
      return;
    }

    // Rate limited
    logger.warn('[rate-limit] Request blocked', { ip, key: config.keyPrefix });
    res.set('X-RateLimit-Limit', String(config.max));
    res.set('X-RateLimit-Remaining', '0');
    res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));

    res.status(429).json({
      success: false,
      error: config.message || 'Too many requests, please try again later.',
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    });
  };
}

// Pre-configured limits for common endpoints
export const limits = {
  agentRun: rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'agent-run' }),
  queue: rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'agent-queue' }),
  email: rateLimit({ windowMs: 60_000, max: 50, keyPrefix: 'email' }),
  scrape: rateLimit({ windowMs: 300_000, max: 5, keyPrefix: 'scrape' }),
  metrics: rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'metrics' }),
  general: rateLimit({ windowMs: 60_000, max: 100, keyPrefix: 'general' }),
};

// Made with Bob
