/**
 * seed-contacts.ts
 *
 * Seeds the 8 target contacts into the PostgreSQL `contacts` table.
 * Run with: npx ts-node agent/src/database/seed/seed-contacts.ts
 *
 * Uses INSERT … ON CONFLICT (email) DO UPDATE so it is safe to re-run.
 */

import 'dotenv/config';
import { db } from '../db.client';

interface SeedContact {
  contact_name: string;
  email:        string;
  phone:        string | null;
  company:      string;
  type:         'prospect' | 'investor' | 'partner' | 'funding';
  tier:         string;
  status:       string;
  notes:        string | null;
  location:     string | null;
  country:      string | null;
}

const contacts: SeedContact[] = [
  // ── PROSPECTS ───────────────────────────────────────────────────────────────
  {
    contact_name: 'Bangali Fofana',
    email:        'bangali@sokogate.com',
    phone:        null,
    company:      'Ultimo Trading Company Limited',
    type:         'prospect',
    tier:         'T1',
    status:       'Not Started',
    notes:        'Primary contact at parent company Ultimo Trading Co. / Sokogate platform',
    location:     null,
    country:      null,
  },
  {
    contact_name: 'Calvince Wuod Lucy',
    email:        'calvinceharheez@gmail.com',
    phone:        null,
    company:      '',
    type:         'prospect',
    tier:         'T2',
    status:       'Not Started',
    notes:        'Prospect — no company associated',
    location:     null,
    country:      null,
  },
  {
    contact_name: 'King Fisherman',
    email:        'kingf6243@gmail.com',
    phone:        null,
    company:      '',
    type:         'prospect',
    tier:         'T2',
    status:       'Not Started',
    notes:        'Prospect — no company associated',
    location:     null,
    country:      null,
  },

  // ── FUNDING ────────────────────────────────────────────────────────────────
  {
    contact_name: 'Grace Njoki',
    email:        'gnjoki@kcb.co.ke',
    phone:        null,
    company:      'KCB Trade Finance',
    type:         'funding',
    tier:         'T1',
    status:       'Not Started',
    notes:        'KCB Trade Finance — trade finance / working capital target',
    location:     null,
    country:      'Kenya',
  },

  // ── PARTNERS ──────────────────────────────────────────────────────────────
  {
    contact_name: 'Carlos Ruiz',
    email:        'carlos@freightlink.io',
    phone:        null,
    company:      'FreightLink Logistics',
    type:         'partner',
    tier:         'T1',
    status:       'Not Started',
    notes:        'FreightLink Logistics — logistics partnership candidate',
    location:     null,
    country:      null,
  },

  // ── INVESTORS ──────────────────────────────────────────────────────────────
  {
    contact_name: 'Aisha Patel',
    email:        'aisha@apexcap.com',
    phone:        null,
    company:      'Apex Capital',
    type:         'investor',
    tier:         'T1',
    status:       'Not Started',
    notes:        'Apex Capital — Series A / growth equity investor',
    location:     null,
    country:      null,
  },
  {
    contact_name: 'James Mwangi',
    email:        'james@buildcorp.co.ke',
    phone:        null,
    company:      'BuildCorp Ltd',
    type:         'investor',
    tier:         'T2',
    status:       'Not Started',
    notes:        'BuildCorp Ltd — construction/real estate investor',
    location:     null,
    country:      'Kenya',
  },
];

async function main(): Promise<void> {
  console.log(`[seed] upserting ${contacts.length} contacts …`);

  let inserted = 0;
  let updated  = 0;

  for (const c of contacts) {
    // Check if the contact already exists
    const existing = await db.query<{ is_new: boolean }>(
      `INSERT INTO contacts
         (contact_name, email, phone, company, type, tier, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email) DO UPDATE SET
         contact_name = EXCLUDED.contact_name,
         phone        = EXCLUDED.phone,
         company      = EXCLUDED.company,
         type         = EXCLUDED.type,
         tier         = EXCLUDED.tier,
         notes        = EXCLUDED.notes,
         updated_at   = NOW()
       RETURNING
         (xmax = 0) AS is_new`,
      [
        c.contact_name,
        c.email,
        c.phone,
        c.company,
        c.type,
        c.tier,
        c.status,
        c.notes,
      ],
    );

    if (existing.rows[0]?.is_new) {
      inserted++;
      console.log(`  [INSERT] ${c.contact_name} <${c.email}> (${c.type})`);
    } else {
      updated++;
      console.log(`  [UPDATE] ${c.contact_name} <${c.email}> (${c.type})`);
    }
  }

  console.log(`\n[seed] done — ${inserted} inserted, ${updated} updated\n`);

  // Print summary
  const { rows } = await db.query(
    `SELECT type, COUNT(*) AS cnt FROM contacts GROUP BY type ORDER BY type`,
  );
  console.log('[seed] contact counts by type:');
  for (const r of rows) {
    console.log(`  ${r.type.padEnd(12)} ${r.cnt}`);
  }
}

main().catch((err) => {
  console.error('[seed] fatal:', err.message);
  process.exit(1);
});
