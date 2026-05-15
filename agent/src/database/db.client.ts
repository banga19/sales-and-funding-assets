import { Pool, PoolClient, QueryResult } from 'pg';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';

class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;

  private constructor() {
    this.pool = new Pool({
      connectionString: agentConfig.database.url,
      min: agentConfig.database.pool.min,
      max: agentConfig.database.pool.max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
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
  public async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query('SELECT 1 as health');
      return result.rows[0]?.health === 1;
    } catch (error) {
      logger.error('Database health check failed', { error });
      return false;
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
