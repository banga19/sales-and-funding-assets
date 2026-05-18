#!/usr/bin/env node
/**
 * scripts/seed-dev.js
 *
 * Seeds the local PostgreSQL DB with schema + test data.
 * Safe to re-run: every INSERT uses ON CONFLICT DO NOTHING / upsert.
 *
 * Usage:
 *   npm run db:seed          # uses DATABASE_URL from .env
 *
 * Flow:
 *   1. Apply infra/docker/001_init.sql
 *   2. Apply infra/docker/002_add_scraper_tables.sql
 *   3. Apply infra/docker/scraper/migrations/003_add_contacts_table.sql
 *   4. Upsert 4 seed contacts (prospect / investor / partner / funding)
 *   5. Upsert conversations linked to those contacts
 *   6. Upsert message_history
 *   7. Upsert scheduled_actions
 *   8. Upsert agent_metrics
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const findDatabaseUrl = () => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const fp of ['agent/.env', 'backend/.env', '.env']) {
    const p = path.resolve(process.cwd(), fp);
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, 'utf8').match(/^DATABASE_URL=(.+)$/m);
      if (m) return m[1].trim();
    }
  }
  console.error('No DATABASE_URL found. Set it in agent/.env, backend/.env, or export it.');
  process.exit(1);
};

const DB = findDatabaseUrl();

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();

  try {
    console.log('=== Applying schema migrations ===');

    const runSql = async (rel) => {
      const p = path.resolve(process.cwd(), rel);
      if (!fs.existsSync(p)) { console.warn(`  ⚠ missing: ${rel}`); return; }
      const sql = fs.readFileSync(p, 'utf8')
        .replace(/^\s*RAISE NOTICE[^;]*;\s*$/gm, '');
      await db.query(sql);
      console.log(`  ✓ ${rel}`);
    };

    await runSql('infra/docker/001_init.sql');
    await runSql('infra/docker/002_add_scraper_tables.sql');
    await runSql('infra/docker/scraper/migrations/003_add_contacts_table.sql');

    console.log('\n=== Seeding contacts ===');
    {
      const r = await db.query(`
        INSERT INTO contacts (id, type, company, contact_name, email, tier, status,
          location, annual_spend_kes, pain_point, engagement_angle,
          fund_name, ticket_size_usd_min, ticket_size_usd_max,
          country, capability, revenue_model,
          institution_type, product_pitched, ticket_size_usd_requested, tenor_months)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (id) DO UPDATE SET company=EXCLUDED.company
        RETURNING id`,
        ['00000000-0000-0000-0001-000000000001','prospect','BuildCorp Ltd','James Mwangi','james@buildcorp.co.ke','T1','Responded','Nairobi',1500000,'High equipment costs','15-20% cost savings',null,null,null,null,null,null,null,null,null,null]);
      console.log(`  ✓ BuildCorp Ltd (prospect) — id ${r.rows[0].id}`);
    }
    {
      const r = await db.query(`INSERT INTO contacts (id, type, company, contact_name, email, tier, status, fund_name, ticket_size_usd_min, ticket_size_usd_max) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET company=EXCLUDED.company RETURNING id`,
        ['00000000-0000-0000-0001-000000000002','investor','Apex Capital','Aisha Patel','aisha@apexcap.com','T1','Contacted','Apex Growth Fund',500000,3000000]);
      console.log(`  ✓ Apex Capital (investor) — id ${r.rows[0].id}`);
    }
    {
      const r = await db.query(`INSERT INTO contacts (id, type, company, contact_name, email, tier, status, country, capability, revenue_model) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET company=EXCLUDED.company RETURNING id`,
        ['00000000-0000-0000-0001-000000000003','partner','FreightLink Logistics','Carlos Ruiz','carlos@freightlink.io','T2','Contacted','Kenya','3PL warehousing & last-mile','Per-shipment + volume rebate']);
      console.log(`  ✓ FreightLink (partner) — id ${r.rows[0].id}`);
    }
    {
      const r = await db.query(`INSERT INTO contacts (id, type, company, contact_name, email, tier, status, institution_type, product_pitched, ticket_size_usd_requested, tenor_months) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET company=EXCLUDED.company RETURNING id`,
        ['00000000-0000-0000-0001-000000000004','funding','KCB Trade Finance','Grace Njoki','gnjoki@kcb.co.ke','T1','Negotiating','trade_finance_bank','working_capital',750000,12]);
      console.log(`  ✓ KCB Trade Finance (funding) — id ${r.rows[0].id}`);
    }

    console.log('\n=== Seeding conversations ===');
    const convos = [
      ['00000000-0000-0000-0001-000000000001','prospect','responded','positive'],
      ['00000000-0000-0000-0001-000000000002','investor','qualified','positive'],
      ['00000000-0000-0000-0001-000000000003','partner','contacted','neutral'],
      ['00000000-0000-0000-0001-000000000004','funding','negotiating','positive'],
    ];
    for (const c of convos) { await db.query(`INSERT INTO conversations (contact_id,contact_type,current_stage,sentiment) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, c); }
    console.log(`  ✓ ${convos.length} conversations`);

    console.log('\n=== Seeding messages ===');
    const msgs = [
      ['00000000-0000-0000-0001-000000000001','prospect','email','outbound','Hi James — can we schedule a 15-min call about excavator financing?'],
      ['00000000-0000-0000-0001-000000000002','investor','email','outbound','Hi Aisha — attached is the updated financial deck you requested.'],
      ['00000000-0000-0000-0001-000000000001','prospect','email','inbound','Yes, Tuesday at 10am works — looking forward to it.'],
      ['00000000-0000-0000-0001-000000000004','funding','email','outbound','Hi Grace — following up on the USD 750K working capital term sheet.'],
    ];
    for (const m of msgs) {
      await db.query(`INSERT INTO message_history (conversation_id,contact_id,contact_type,channel,direction,content) VALUES ((SELECT id FROM conversations WHERE contact_id=$1 AND contact_type=$2),$1,$2,$3,$4,$5)`, m);
    }
    console.log(`  ✓ ${msgs.length} messages`);

    console.log('\n=== Seeding scheduled actions ===');
    const acts = [
      ['00000000-0000-0000-0001-000000000001','prospect','send_followup', new Date(Date.now()+72*3600_000)],
      ['00000000-0000-0000-0001-000000000002','investor','schedule_meeting', new Date(Date.now()+7*86400_000)],
    ];
    for (const a of acts) {
      await db.query(`INSERT INTO scheduled_actions (conversation_id,contact_id,contact_type,action_type,scheduled_for,status)
        VALUES ((SELECT id FROM conversations WHERE contact_id=$1 AND contact_type=$2),$1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING`, a);
    }
    console.log(`  ✓ ${acts.length} scheduled actions`);

    console.log('\n=== Seeding metrics ===');
    const today = new Date().toISOString().slice(0,10);
    for (const [name, val, ct, ch] of [
      ['emails_sent',12,'prospect','email'],
      ['emails_opened',4,'prospect','email'],
      ['emails_replied',2,'prospect','email'],
      ['meetings_scheduled',1,'prospect','email'],
      ['conversions',1,'funding','email'],
    ]) {
      await db.query('INSERT INTO agent_metrics (date,metric_name,metric_value,contact_type,channel) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [today, name, val, ct, ch]);
    }
    console.log('  ✓ 6 nightly metrics');

    console.log('\n🎉  Database ready.\n   http://localhost:3000  → backend\n   http://localhost:3001  → frontend\n   http://localhost:3002  → agent (if running)\n');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await db.end();
  }
})();
