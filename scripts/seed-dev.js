#!/usr/bin/env node
/**
 * scripts/seed-dev.js
 *
 * Seeds the local PostgreSQL instance with the Sokogate agent schema
 * and a handful of test contacts.  Safe to run repeatedly (uses INSERT
 * … ON CONFLICT DO NOTHING).
 *
 * Usage:
 *   npm run db:seed          # uses DATABASE_URL from env/.env files
 *   DATABASE_URL=... node scripts/seed-dev.js
 *
 * Requires:
 *   DATABASE_URL in environment (agent/.env or backend/.env)
 *   PostgreSQL container running:  npm run db:start
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ── Locate DATABASE_URL ────────────────────────────────────────────────────────
function findDatabaseUrl(): string {
  // Explicit override
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // Try .env files (supports frontend/backend/agent levels)
  const candidates = [
    resolve(process.cwd(), 'backend', '.env'),
    resolve(process.cwd(), 'agent', '.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const fp of candidates) {
    if (existsSync(fp)) {
      const text = readFileSync(fp, 'utf-8');
      const m = text.match(/^DATABASE_URL=(.+)$/m);
      if (m) return m[1];
    }
  }
  console.error('No DATABASE_URL found. Set it in agent/.env, backend/.env, or export it.');
  process.exit(1);
}

// ── Connect & Seed ─────────────────────────────────────────────────────────────
const DATABASE_URL = findDatabaseUrl();

// Lazy-import pg so the script works even without explicit install
import('pg').then(async ({ Client }) => {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL — seeding…');

    // ── 1. Run schema ─────────────────────────────────────────────────────
    const sqlPath = resolve(process.cwd(), 'infra', 'docker', '001_init.sql');
    if (existsSync(sqlPath)) {
      const sql = readFileSync(sqlPath, 'utf-8');
      await client.query(sql);
      console.log('✓ Schema applied (infra/docker/001_init.sql)');
    } else {
      console.warn('⚠ 001_init.sql not found — skipping schema step');
    }

    // ── 2. Seed conversations + contacts record ───────────────────────────
    const seedContacts = [
      { contactId: 'c-001', contactType: 'prospect',  stage: 'engaged',   sentiment: 'positive' },
      { contactId: 'c-002', contactType: 'investor',  stage: 'qualified', sentiment: 'positive' },
      { contactId: 'c-003', contactType: 'partner',   stage: 'contacted', sentiment: 'neutral'  },
    ];

    for (const c of seedContacts) {
      await client.query(
        `INSERT INTO conversations (contact_id, contact_type, current_stage, sentiment)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (contact_id, contact_type) DO NOTHING`,
        [c.contactId, c.contactType, c.stage, c.sentiment],
      );
    }
    console.log(`✓ Seeded ${seedContacts.length} conversations`);

    // ── 3. Seed message_history ───────────────────────────────────────────
    const seedMessages = [
      { contactId: 'c-001', channel: 'email', direction: 'outbound',
        content: 'Hi James — can we schedule a 15-min quick call about your excavator financing?' },
      { contactId: 'c-002', channel: 'email', direction: 'outbound',
        content: 'Hi Aisha — attached is the updated financial projections deck you requested.' },
      { contactId: 'c-001', channel: 'email', direction: 'inbound',
        content: 'Yes, Tuesday at 10am works — I am looking forward to it.' },
    ];

    for (const m of seedMessages) {
      await client.query(
        `INSERT INTO message_history (conversation_id, contact_id, contact_type, channel, direction, content)
         VALUES (
           (SELECT id FROM conversations WHERE contact_id = $1 AND contact_type = $2),
           $1, $2, $3, $4, $5
         )`,
        [m.contactId, m.contactId, m.channel, m.direction, m.content],
      );
    }
    console.log(`✓ Seeded ${seedMessages.length} messages`);

    // ── 4. Seed scheduled_actions ─────────────────────────────────────────
    const seedActions = [
      { contactId: 'c-001', actionType: 'send_followup', scheduledFor: new Date(Date.now() + 72 * 3600_000) },
      { contactId: 'c-002', actionType: 'schedule_meeting', scheduledFor: new Date(Date.now() + 7 * 86400_000) },
    ];

    const convQ = 'SELECT id FROM conversations WHERE contact_id = $1 AND contact_type = $2';
    for (const a of seedActions) {
      // Colleagues if this person typed pasted any of the code — such will erase
      const type = (a as { contactType?: string }).contactType ?? 'prospect';
      const { rows } = await client.query(convQ, [a.contactId, type]);
      if (rows[0]?.id) {
        await client.query(
          `INSERT INTO scheduled_actions (conversation_id, contact_id, contact_type, action_type, scheduled_for, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [rows[0].id, a.contactId, type, a.actionType, a.scheduledFor],
        );
      }
    }
    console.log(`✓ Seeded ${seedActions.length} scheduled actions`);

    // ── 5. Seed agent_metrics ─────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const seedMetrics = [
      { name: 'emails_sent',            value: 12,  contactType: 'prospect', channel: 'email' },
      { name: 'emails_opened',          value:  4,  contactType: 'prospect', channel: 'email' },
      { name: 'emails_replied',         value:  2,  contactType: 'prospect', channel: 'email' },
      { name: 'whatsapp_sent',          value:  8,  contactType: 'prospect', channel: 'whatsapp' },
      { name: 'meetings_scheduled',     value:  1,  contactType: 'prospect', channel: 'email' },
      { name: 'conversions',            value:  0,  contactType: 'prospect', channel: 'email' },
    ];

    for (const m of seedMetrics) {
      await client.query(
        `INSERT INTO agent_metrics (date, metric_name, metric_value, contact_type, channel)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (date, metric_name, contact_type) DO NOTHING`,
        [today, m.name, m.value, m.contactType, m.channel],
      );
    }
    console.log(`✓ Seeded ${seedMetrics.length} daily metrics`);

    console.log('\n🎉 Dev database is ready.\n  Backend  → http://localhost:3000\n  Frontend → http://localhost:3001\n  Agent    → http://localhost:3002 (if running)');

  } catch (err: any) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}).catch((err) => {
  console.error('pg not installed in backend/ — run: cd backend && npm install pg');
  process.exit(1);
});
