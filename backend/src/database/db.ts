import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

// ─── Singleton pg Pool ─────────────────────────────────────────────────────────

type PgPoolConfig = {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
  max?: number; min?: number;
  idleTimeoutMillis?: number; connectionTimeoutMillis?: number;
};

const DEFAULT_CFG: PgPoolConfig = {
  connectionString: process.env.DATABASE_URL || '',
  ssl:               process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : { rejectUnauthorized: false },
  max:               parseInt(process.env.DB_POOL_MAX || '10', 10),
  min:               parseInt(process.env.DB_POOL_MIN ||  '2', 10),
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 10_000,
};

let pool: Pool | null = null;
let _initialised = false;

function getConfig(): PgPoolConfig {
  return {
    ...DEFAULT_CFG,
    connectionString: process.env.DATABASE_URL || DEFAULT_CFG.connectionString,
    ssl:   process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : { rejectUnauthorized: false },
    max:   parseInt(process.env.DB_POOL_MAX || '10', 10),
    min:   parseInt(process.env.DB_POOL_MIN ||  '2', 10),
  };
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getConfig());
    pool.on('error', (err) => console.error('[db] pool error:', err.message));
    pool.on('connect',  () => console.log('[db] new connection established'));
    pool.on('acquire',  () => {});
    pool.on('release',  () => {});
    _initialised = true;
  }
  return pool;
}

/** Thin wrapper around pool.query with timestamp logging. */
export async function dbQuery<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const start   = Date.now();
  const p       = getPool();
  const result  = await p.query<T>(text, params);
  const elapsed = Date.now() - start;
  console.debug('[db]', `${elapsed}ms`, text.split(/\s+/).slice(0, 4).join(' '), `rows=${result.rowCount}`);
  return result;
}

export async function dbTransaction<T>(cb: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function dbHealthCheck(): Promise<{ healthy: boolean; error?: string }> {
  try {
    const { rows } = await dbQuery<{ ok: number }>('SELECT 1 AS ok');
    return { healthy: rows[0]?.ok === 1 };
  } catch (err: any) {
    return { healthy: false, error: `${err.code || 'ERR'}: ${err.message}` };
  }
}

export async function dbClose(): Promise<void> {
  if (pool) { await pool.end(); pool = null; _initialised = false; }
}
