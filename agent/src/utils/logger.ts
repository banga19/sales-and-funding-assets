/**
 * logger.ts
 *
 * Structured logging with Winston.
 * - JSON format for production (log aggregation ready)
 * - Colorized console format for development
 * - Correlation IDs for request tracing
 * - File rotation in production
 */

import winston from 'winston';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { agentConfig } from '../config/agent.config';

// AsyncLocalStorage for correlation IDs across async calls
export const correlationStorage = new AsyncLocalStorage<Map<string, string>>();

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Define format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    const correlationId = info.correlationId ? ` [${info.correlationId}]` : '';
    return `${info.timestamp} ${info.level}:${correlationId} ${info.message}${
      info.stack ? `\n${info.stack}` : ''
    }${
      Object.keys(info).length > 4
        ? `\n${JSON.stringify(
            Object.fromEntries(
              Object.entries(info).filter(
                ([key]) => !['timestamp', 'level', 'message', 'stack', 'correlationId'].includes(key)
              )
            ),
            null,
            2
          )}`
        : ''
    }`;
  })
);

// Define transports
const transports: winston.transport[] = [
  // Console transport
  new winston.transports.Console({
    format: agentConfig.monitoring.sentry.environment === 'production' ? format : consoleFormat,
  }),
];

// Add file transports in production
if (agentConfig.monitoring.sentry.environment === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  );
}

// Create logger instance
export const logger = winston.createLogger({
  level: agentConfig.monitoring.logLevel,
  levels,
  format,
  transports,
  exitOnError: false,
  defaultMeta: {
    service: 'sokogate-agent',
    environment: agentConfig.monitoring.sentry.environment,
  },
});

// Wrap logger methods to inject correlation ID
function withCorrelation(method: string) {
  return function (this: winston.Logger, message: string, meta?: Record<string, unknown>) {
    const store = correlationStorage.getStore();
    const correlationId = store?.get('correlationId');
    return (this as any)[method](message, {
      ...meta,
      ...(correlationId ? { correlationId } : {}),
    });
  };
}

// Create correlation ID for requests
export function createCorrelationId(): string {
  return randomUUID();
}

// Middleware to attach correlation ID to requests
export function correlationMiddleware(req: any, _res: any, next: any) {
  const correlationId = req.headers['x-correlation-id'] as string || createCorrelationId();
  const store = new Map<string, string>();
  store.set('correlationId', correlationId);
  correlationStorage.run(store, next);
}

// Create a stream object for Morgan HTTP logger
export const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

// Helper functions for structured logging
export const loggers = {
  // Log message sent
  messageSent: (contactId: string, channel: string, success: boolean) => {
    logger.info('Message sent', {
      contactId,
      channel,
      success,
      timestamp: new Date().toISOString(),
    });
  },

  // Log message received
  messageReceived: (contactId: string, channel: string, intent: string) => {
    logger.info('Message received', {
      contactId,
      channel,
      intent,
      timestamp: new Date().toISOString(),
    });
  },

  // Log escalation
  escalation: (contactId: string, reason: string) => {
    logger.warn('Escalation triggered', {
      contactId,
      reason,
      timestamp: new Date().toISOString(),
    });
  },

  // Log API error
  apiError: (service: string, error: any) => {
    logger.error('API error', {
      service,
      error: error.message || error,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  },

  // Log job execution
  jobExecution: (jobName: string, status: 'started' | 'completed' | 'failed', duration?: number) => {
    const level = status === 'failed' ? 'error' : 'info';
    logger.log(level, `Job ${status}`, {
      jobName,
      status,
      duration: duration ? `${duration}ms` : undefined,
      timestamp: new Date().toISOString(),
    });
  },

  // Log rate limit hit
  rateLimitHit: (channel: string, limit: number) => {
    logger.warn('Rate limit reached', {
      channel,
      limit,
      timestamp: new Date().toISOString(),
    });
  },
};

export default logger;

// Made with Bob
