import { Pool, PoolClient, QueryResult } from 'pg';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';

class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;

  private constructor() {
    // Local PostgreSQL does not speak SSL; only send SSL when NODE_ENV=production
    // (cloud / Supabase). Setting ssl:false is what actually disables the TLS upgrade
    // attempt that causes "server does not support SSL connections".
    const sslDisabled = process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false;

    this.pool = new Pool({
      connectionString: agentConfig.database.url,
      min: agentConfig.database.pool.min,
      max: agentConfig.database.pool.max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: sslDisabled,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err });
    });

    // Log successful connection
    this.pool.on('connect', () => {
      logger.info('New database connection established');
    });
  }

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  /**
   * Connect to database with retry logic
   */
  private async connectWithRetry(maxRetries = 3, delay = 2000): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        client.release();
        logger.info('Database connection established', { attempt });
        return;
      } catch (error: any) {
        logger.warn(`Connection attempt ${attempt}/${maxRetries} failed`, {
          error: error.message,
          code: error.code
        });
        
        if (attempt === maxRetries) {
          throw new Error(`Failed to connect after ${maxRetries} attempts: ${error.message} (${error.code})`);
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }

  /**
   * Initialize and verify database connection
   */
  public async initialize(): Promise<void> {
    await this.connectWithRetry();
    logger.info('Database client initialized successfully');
  }

  /**
   * Execute a query
   */
  public async query<T = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Query executed', {
        query: text,
        duration: `${duration}ms`,
        rows: result.rowCount,
      });
      
      return result;
    } catch (error) {
      logger.error('Query execution failed', {
        query: text,
        params,
        error,
      });
      throw error;
    }
  }

  /**
   * Get a client from the pool for transactions
   */
  public async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  /**
   * Execute a transaction
   */
  public async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check database connection health
   */
  public async healthCheck(): Promise<{ healthy: boolean; error?: string; details?: any }> {
    try {
      const result = await this.query('SELECT 1 as health');
      const healthy = result.rows[0]?.health === 1;
      return { healthy };
    } catch (error: any) {
      const errorDetails = {
        code: error.code,
        message: error.message,
        severity: error.severity,
        detail: error.detail,
        hint: error.hint,
        routine: error.routine,
      };
      
      // Mask password in connection string for logging
      const maskedConnectionString = agentConfig.database.url.replace(/:[^:@]+@/, ':****@');
      
      logger.error('Database health check failed', {
        error: errorDetails,
        connectionString: maskedConnectionString,
        troubleshooting: [
          'Verify DATABASE_URL in .env file',
          'Check database password is correct',
          'Ensure SSL is configured (required for Supabase)',
          'Verify network connectivity to database host',
          'Check IP allowlist in database dashboard'
        ]
      });
      
      return {
        healthy: false,
        error: `${error.code || 'UNKNOWN'}: ${error.message}`,
        details: errorDetails
      };
    }
  }

  /**
   * Close all connections
   */
  public async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed');
  }
}

// Export singleton instance
export const db = DatabaseClient.getInstance();
export default db;

// Made with Bob
