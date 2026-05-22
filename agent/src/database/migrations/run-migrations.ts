import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const agentRoot = path.resolve(__dirname, '../../../');
const repoRoot = path.resolve(agentRoot, '..');

  const migrationFiles = [
  path.join(repoRoot, 'infra/docker/001_init.sql'),
  path.join(repoRoot, 'infra/docker/002_add_scraper_tables.sql'),
  path.join(repoRoot, 'infra/docker/003_add_product_sourcing_columns.sql'),
  path.join(repoRoot, 'infra/docker/004_b2b_product_extensions.sql'),
  path.join(agentRoot, 'src/database/migrations/004_add_agent_tables.sql'),
  path.join(agentRoot, 'src/database/migrations/005_add_agent_system_tables.sql'),
  path.join(agentRoot, 'src/database/migrations/006_market_leads_and_contacts_missing_columns.sql'),
  path.join(agentRoot, 'src/database/migrations/006_add_image_urls_to_content_pieces.sql'),
  path.join(agentRoot, 'src/database/migrations/007_add_email_logs.sql'),
   path.join(agentRoot, 'src/database/migrations/008_add_conversation_memory_table.sql'),
    path.join(agentRoot, 'src/database/migrations/009_add_received_at_message_history.sql'),
  ];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const client = new Client({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  try {
    for (const file of migrationFiles) {
      if (!fs.existsSync(file)) {
        throw new Error(`Migration file not found: ${file}`);
      }
      const sql = fs.readFileSync(file, 'utf8');
      console.log(`[migrate] applying ${path.relative(repoRoot, file)}`);
      await client.query(sql);
    }
    console.log('[migrate] complete');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[migrate] failed:', error.message);
  process.exit(1);
});
