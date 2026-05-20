/**
 * health-check.service.ts
 *
 * Deep health checks for all service dependencies:
 * - PostgreSQL connectivity
 * - Redis/Memurai connectivity
 * - NVIDIA AI API reachability
 * - BullMQ queue status
 *
 * Returns structured health status for monitoring dashboards.
 */

import { db } from '../database/db.client';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: Record<string, HealthCheck>;
}

export interface HealthCheck {
  status: 'pass' | 'fail' | 'warn';
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

const startTime = Date.now();

/**
 * Check PostgreSQL connectivity.
 */
async function checkPostgres(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await db.query('SELECT 1');
    return {
      status: 'pass',
      latencyMs: Date.now() - start,
      message: 'PostgreSQL connected',
    };
  } catch (err: any) {
    return {
      status: 'fail',
      latencyMs: Date.now() - start,
      message: `PostgreSQL error: ${err.message}`,
    };
  }
}

/**
 * Check Redis/Memurai connectivity.
 */
async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const IORedis = (await import('ioredis')).default;
    const redis = new IORedis({
      host: agentConfig.redis.host,
      port: agentConfig.redis.port,
      password: agentConfig.redis.password,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });

    await redis.ping();
    await redis.quit();

    return {
      status: 'pass',
      latencyMs: Date.now() - start,
      message: 'Redis connected',
    };
  } catch (err: any) {
    return {
      status: 'fail',
      latencyMs: Date.now() - start,
      message: `Redis error: ${err.message}`,
    };
  }
}

/**
 * Check NVIDIA AI API reachability.
 */
async function checkNvidiaAI(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const response = await fetch(`${agentConfig.ai.baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${agentConfig.ai.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });

    return {
      status: response.ok ? 'pass' : 'warn',
      latencyMs: Date.now() - start,
      message: response.ok ? 'NVIDIA AI API reachable' : `NVIDIA API returned ${response.status}`,
    };
  } catch (err: any) {
    return {
      status: 'warn',
      latencyMs: Date.now() - start,
      message: `NVIDIA AI API check failed: ${err.message}`,
    };
  }
}

/**
 * getFullHealthStatus — returns the shape the frontend dashboard expects:
 * { status, timestamp, checks: { database: { healthy }, email: boolean, nvidia: boolean } }
 */
export async function getHealthStatus(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: { healthy: boolean; error?: string; latencyMs?: number };
    email: boolean;
    nvidia: boolean;
  };
}> {
  const [postgres, redis, nvidia, email] = await Promise.allSettled([
    checkPostgres(),
    checkRedis(),
    checkNvidiaAI(),
    checkEmail(),
  ]);

  const postgresCheck = postgres.status === 'fulfilled' ? postgres.value : { status: 'fail' as const };
  const redisCheck = redis.status === 'fulfilled' ? redis.value : { status: 'fail' as const };
  const nvidiaCheck = nvidia.status === 'fulfilled' ? nvidia.value : { status: 'warn' as const };
  const emailCheck = email.status === 'fulfilled' ? email.value : false;

  // Database is healthy if both Postgres and Redis are up
  const dbHealthy = postgresCheck.status === 'pass' && redisCheck.status === 'pass';
  const nvidiaHealthy = nvidiaCheck.status === 'pass';

  // Determine overall status
  const hasFailures = postgresCheck.status === 'fail' || redisCheck.status === 'fail';
  const hasWarnings = nvidiaCheck.status === 'warn' || !emailCheck;

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (hasFailures) status = 'unhealthy';
  else if (hasWarnings) status = 'degraded';

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || '0.0.0',
    checks: {
      database: {
        healthy: dbHealthy,
        latencyMs: (postgresCheck.status === 'pass' ? postgresCheck.latencyMs : 0) +
                   (redisCheck.status === 'pass' ? redisCheck.latencyMs : 0),
        ...(postgresCheck.status === 'fail' ? { error: postgresCheck.message } : {}),
        ...(redisCheck.status === 'fail' ? { error: redisCheck.message } : {}),
      },
      email: emailCheck,
      nvidia: nvidiaHealthy,
    },
  };
}

/**
 * Check email service (Resend) connectivity.
 */
async function checkEmail(): Promise<boolean> {
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(agentConfig.email.resend.apiKey);

    // Try to list domains (lightweight check)
    await resend.domains.list();
    return true;
  } catch {
    return false;
  }
}

// Made with Bob
