/**
 * response-cache.service.ts
 *
 * Redis-backed response cache for LLM-generated content.
 * Caches enrichment results, pitch summaries, and marketing assets
 * to avoid redundant LLM calls for identical inputs.
 *
 * Cache keys are SHA-256 hashes of the input parameters.
 * TTL is configurable per cache namespace.
 */

import { createHash } from 'crypto';
import IORedis from 'ioredis';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';

let redisClient: IORedis | null = null;

function getClient(): IORedis | null {
  if (!redisClient) {
    try {
      redisClient = new IORedis({
        host: agentConfig.redis.host,
        port: agentConfig.redis.port,
        password: agentConfig.redis.password,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
      });
      redisClient.on('error', (err) => {
        logger.warn('[cache] Redis error', { error: err.message });
      });
    } catch {
      return null;
    }
  }
  return redisClient;
}

function hashKey(namespace: string, params: Record<string, unknown> | string): string {
  const payload = typeof params === 'string' ? `${namespace}:${params}` : JSON.stringify({ namespace, params });
  return `cache:${createHash('sha256').update(payload).digest('hex').slice(0, 16)}`;
}

export interface CacheConfig {
  ttlSeconds?: number;
  namespace: string;
}

/**
 * Get cached response.
 * Returns null on cache miss or Redis failure.
 */
export async function getCached<T>(namespace: string, params: Record<string, unknown> | string): Promise<T | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const key = hashKey(namespace, params);
    const cached = await client.get(key);
    if (cached) {
      logger.debug('[cache] HIT', { namespace, key: key.slice(0, 40) });
      return JSON.parse(cached) as T;
    }
    logger.debug('[cache] MISS', { namespace, key: key.slice(0, 40) });
    return null;
  } catch (err: any) {
    logger.warn('[cache] Get failed', { error: err.message });
    return null;
  }
}

/**
 * Cache a response.
 * Silently fails if Redis is unavailable.
 */
export async function setCached<T>(
  namespace: string,
  params: Record<string, unknown> | string,
  data: T,
  ttlSeconds = 3600,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const key = hashKey(namespace, params);
    await client.setex(key, ttlSeconds, JSON.stringify(data));
    logger.debug('[cache] SET', { namespace, key: key.slice(0, 40), ttlSeconds });
  } catch (err: any) {
    logger.warn('[cache] Set failed', { error: err.message });
  }
}

/**
 * Invalidate all entries in a namespace.
 */
export async function invalidateNamespace(namespace: string): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const keys = await client.keys(`cache:${namespace}:*`);
    if (keys.length > 0) {
      await client.del(keys);
      logger.info('[cache] Namespace invalidated', { namespace, keysDeleted: keys.length });
    }
  } catch (err: any) {
    logger.warn('[cache] Invalidate failed', { error: err.message });
  }
}

/**
 * Cache stats.
 */
export async function getCacheStats(): Promise<{ keys: number; memory?: string }> {
  const client = getClient();
  if (!client) return { keys: 0 };

  try {
    const keys = await client.keys('cache:*');
    const info = await client.info('memory');
    const memoryMatch = info.match(/used_memory_human:(.+)/);
    return {
      keys: keys.length,
      memory: memoryMatch?.[1]?.trim(),
    };
  } catch {
    return { keys: 0 };
  }
}

// Made with Bob
