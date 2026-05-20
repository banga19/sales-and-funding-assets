/**
 * agent-response.types.ts
 *
 * Standardized response schema for all agent executions.
 * Every agent route should return this shape (or a typed extension).
 */

export interface AgentResponse<T = unknown> {
  success: boolean;
  agent: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  data: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentError {
  success: false;
  agent: string;
  error: string;
  stack?: string;
  timestamp: string;
}

/**
 * Wrap any agent execution result in the standard response format.
 */
export function wrapAgentResponse<T>(
  agentName: string,
  data: T,
  startedAt: Date,
  completedAt: Date,
  metadata?: Record<string, unknown>,
): AgentResponse<T> {
  return {
    success: true,
    agent: agentName,
    runId: crypto.randomUUID(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    data,
    metadata,
  };
}

/**
 * Wrap any agent error in the standard error format.
 */
export function wrapAgentError(
  agentName: string,
  error: Error,
): AgentError {
  return {
    success: false,
    agent: agentName,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  };
}

// Made with Bob
