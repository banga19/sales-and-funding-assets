/**
 * migrations/
 *
 * Simple SQL migration runner.
 * Usage: npx ts-node src/database/migrate.ts [up|down|status]
 *
 * Migrations are numbered sequentially: 001_initial.sql, 002_add_column.sql, etc.
 * Applied migrations are tracked in the `schema_migrations` table.
 */

import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
}

async function ensureMigrationsTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<number[]> {
  await ensureMigrationsTable();
  const { rows } = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  return rows.map((r: any) => r.version);
}

function loadMigrations(): Migration[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn('[migrate] Migrations directory not found', { dir: MIGRATIONS_DIR });
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  return files.map((file) => {
    const match = file.match(/^(\d+)_([\w-]+)\.sql$/);
    if (!match) {
      logger.warn('[migrate] Skipping invalid migration filename', { file });
      return null;
    }

    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const parts = content.split('-- DOWN');

    return {
      version: parseInt(match[1], 10),
      name: match[2],
      up: parts[0].trim(),
      down: parts[1]?.trim(),
    };
  }).filter(Boolean) as Migration[];
}

export async function runMigrations(direction: 'up' | 'down' = 'up'): Promise<void> {
  const migrations = loadMigrations();
  const applied = await getAppliedMigrations();

  if (direction === 'up') {
    const pending = migrations.filter(m => !applied.includes(m.version));

    if (pending.length === 0) {
      logger.info('[migrate] No pending migrations');
      return;
    }

    for (const migration of pending) {
      logger.info('[migrate] Applying', { version: migration.version, name: migration.name });
      await db.query(migration.up);
      await db.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ]);
      logger.info('[migrate] Applied', { version: migration.version });
    }

    logger.info('[migrate] All migrations applied', { count: pending.length });
  } else {
    const lastApplied = applied[applied.length - 1];
    if (!lastApplied) {
      logger.info('[migrate] No migrations to rollback');
      return;
    }

    const migration = migrations.find(m => m.version === lastApplied);
    if (!migration?.down) {
      logger.error('[migrate] No DOWN migration available', { version: lastApplied });
      return;
    }

    logger.info('[migrate] Rolling back', { version: lastApplied });
    await db.query(migration.down);
    await db.query('DELETE FROM schema_migrations WHERE version = $1', [lastApplied]);
    logger.info('[migrate] Rolled back', { version: lastApplied });
  }
}

export async function migrationStatus(): Promise<void> {
  const migrations = loadMigrations();
  const applied = await getAppliedMigrations();

  logger.info('[migrate] Status');
  for (const m of migrations) {
    const status = applied.includes(m.version) ? 'APPLIED' : 'PENDING';
    logger.info(`  ${m.version}_${m.name}: ${status}`);
  }
}

// CLI entry point
if (require.main === module) {
  const command = process.argv[2] || 'up';

  (async () => {
    try {
      if (command === 'status') {
        await migrationStatus();
      } else {
        await runMigrations(command as 'up' | 'down');
      }
      process.exit(0);
    } catch (err: any) {
      logger.error('[migrate] Failed', { error: err.message });
      process.exit(1);
    }
  })();
}

// Made with Bob
