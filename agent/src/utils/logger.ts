import winston from 'winston';
import { agentConfig } from '../config/agent.config';

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
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}${
      info.stack ? `\n${info.stack}` : ''
    }${
      Object.keys(info).length > 3 
        ? `\n${JSON.stringify(
            Object.fromEntries(
              Object.entries(info).filter(
                ([key]) => !['timestamp', 'level', 'message', 'stack'].includes(key)
              )
            ),
            null,
            2
          )}`
        : ''
    }`
  )
);

// Define transports
const transports: winston.transport[] = [
  // Console transport
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

// Add file transports in production
if (agentConfig.monitoring.sentry.environment === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format,
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
});

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
