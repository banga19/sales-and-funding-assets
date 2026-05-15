import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

/**
 * Queue Manager
 * Manages BullMQ job queues for scheduled tasks
 */
export class QueueManager {
  private connection: IORedis;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();

  constructor() {
    // Create Redis connection
    this.connection = new IORedis({
      host: agentConfig.redis.host,
      port: agentConfig.redis.port,
      password: agentConfig.redis.password,
      maxRetriesPerRequest: null,
    });

    this.connection.on('error', (error) => {
      logger.error('Redis connection error', { error });
    });

    this.connection.on('connect', () => {
      logger.info('Redis connected for job queues');
    });
  }

  /**
   * Create a queue
   */
  public createQueue(name: string): Queue {
    if (this.queues.has(name)) {
      return this.queues.get(name)!;
    }

    const queue = new Queue(name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
    });

    this.queues.set(name, queue);
    logger.info(`Queue created: ${name}`);

    return queue;
  }

  /**
   * Create a worker
   */
  public createWorker(
    name: string,
    processor: (job: any) => Promise<any>
  ): Worker {
    if (this.workers.has(name)) {
      return this.workers.get(name)!;
    }

    const worker = new Worker(name, processor, {
      connection: this.connection,
      concurrency: 5,
      limiter: {
        max: 10,
        duration: 1000,
      },
    });

    // Event handlers
    worker.on('completed', (job) => {
      logger.logJob(name, 'completed', {
        job_id: job.id,
        duration: job.finishedOn ? job.finishedOn - job.processedOn! : 0,
      });
    });

    worker.on('failed', (job, error) => {
      logger.logJob(name, 'failed', {
        job_id: job?.id,
        error: error.message,
        attempts: job?.attemptsMade,
      });
    });

    worker.on('error', (error) => {
      logger.error(`Worker error: ${name}`, { error });
    });

    this.workers.set(name, worker);
    logger.info(`Worker created: ${name}`);

    return worker;
  }

  /**
   * Create queue events listener
   */
  public createQueueEvents(name: string): QueueEvents {
    if (this.queueEvents.has(name)) {
      return this.queueEvents.get(name)!;
    }

    const queueEvents = new QueueEvents(name, {
      connection: this.connection,
    });

    queueEvents.on('waiting', ({ jobId }) => {
      logger.debug(`Job waiting: ${name}/${jobId}`);
    });

    queueEvents.on('active', ({ jobId }) => {
      logger.debug(`Job active: ${name}/${jobId}`);
    });

    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      logger.debug(`Job completed: ${name}/${jobId}`);
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.warn(`Job failed: ${name}/${jobId}`, { reason: failedReason });
    });

    this.queueEvents.set(name, queueEvents);
    logger.info(`Queue events listener created: ${name}`);

    return queueEvents;
  }

  /**
   * Add a job to a queue
   */
  public async addJob(
    queueName: string,
    jobName: string,
    data: any,
    options?: any
  ): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    await queue.add(jobName, data, options);
    logger.info(`Job added to queue: ${queueName}/${jobName}`, { data });
  }

  /**
   * Add a repeating job
   */
  public async addRepeatingJob(
    queueName: string,
    jobName: string,
    data: any,
    cronExpression: string
  ): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    await queue.add(jobName, data, {
      repeat: {
        pattern: cronExpression,
      },
    });

    logger.info(`Repeating job added: ${queueName}/${jobName}`, {
      cron: cronExpression,
    });
  }

  /**
   * Get queue statistics
   */
  public async getQueueStats(queueName: string): Promise<any> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Pause a queue
   */
  public async pauseQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    await queue.pause();
    logger.info(`Queue paused: ${queueName}`);
  }

  /**
   * Resume a queue
   */
  public async resumeQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    await queue.resume();
    logger.info(`Queue resumed: ${queueName}`);
  }

  /**
   * Clean old jobs
   */
  public async cleanQueue(
    queueName: string,
    grace: number = 24 * 3600 * 1000
  ): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    await queue.clean(grace, 1000, 'completed');
    await queue.clean(grace * 7, 1000, 'failed');
    
    logger.info(`Queue cleaned: ${queueName}`);
  }

  /**
   * Close all connections
   */
  public async close(): Promise<void> {
    logger.info('Closing queue manager...');

    // Close all workers
    for (const [name, worker] of this.workers) {
      await worker.close();
      logger.info(`Worker closed: ${name}`);
    }

    // Close all queue events
    for (const [name, queueEvents] of this.queueEvents) {
      await queueEvents.close();
      logger.info(`Queue events closed: ${name}`);
    }

    // Close all queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.info(`Queue closed: ${name}`);
    }

    // Close Redis connection
    await this.connection.quit();
    logger.info('Redis connection closed');
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      await this.connection.ping();
      return true;
    } catch (error) {
      logger.error('Queue manager health check failed', { error });
      return false;
    }
  }
}

export const queueManager = new QueueManager();

// Made with Bob
