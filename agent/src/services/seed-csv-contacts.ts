import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

const VALID_STATUSES = new Set(['Not Started', 'Contacted', 'In Progress', 'Completed', 'Paused', 'Blocked']);

function mapStatus(s: string): string {
  const st = (s || '').trim();
  if (VALID_STATUSES.has(st)) return st;
  if (/Not Contacted|Not_Started/i.test(st)) return 'Not Started';
  if (/Contacted/i.test(st)) return 'Contacted';
  if (/In Progress|In_Progress|Working/i.test(st)) return 'In Progress';
  if (/Completed|Done|Signed/i.test(st)) return 'Completed';
  if (/Paused|On Hold|Hold/i.test(st)) return 'Paused';
  if (/Blocked|NHOD/i.test(st)) return 'Blocked';
  return 'Not Started';
}

function extractEmail(raw: string): string | null {
  if (!raw) return null;
  if (/NO\s+EMAIL\s+FOUND/i.test(raw)) return null;
  if (/UNCONFIRMED-DOMAIN/i.test(raw)) return null;
  if (/through\s/i.test(raw)) return null;
  if (/FIND\s+VIA/i.test(raw)) return null;
  const m = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return m ? m[1].toLowerCase() : null;
}

function readCsv(filePath: string): any[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const row: any = {};
    headers.forEach((h, idx) => { row[h.trim()] = (cols[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

interface SeedResult {
  imported: number;
  total: number;
}

export async function seedCsvContacts(db: any): Promise<SeedResult> {
  const projectRoot = process.cwd();
  let imported = 0;

  const configs = [
    {
      path: join(projectRoot, 'TRACKER-INVESTORS.csv'),
      type: 'investor',
      nameField: 'FUND_NAME',
      fallbackName: 'INVESTOR',
      emailField: 'CONTACT_NAME',
      tierField: 'TIER',
      statusField: 'STATUS',
    },
    {
      path: join(projectRoot, 'TRACKER-PARTNERSHIPS.csv'),
      type: 'partner',
      nameField: 'COMPANY_NAME',
      fallbackName: 'PARTNER',
      emailField: 'EMAIL',
      tierField: 'TIER',
      statusField: 'STATUS',
    },
    {
      path: join(projectRoot, 'TRACKER-PROSPECTS.csv'),
      type: 'prospect',
      nameField: 'COMPANY',
      fallbackName: 'PROSPECT',
      emailField: 'EMAIL',
      tierField: 'TIER',
      statusField: 'STATUS',
    },
  ];

  for (const cfg of configs) {
    const rows = readCsv(cfg.path);
    for (const row of rows) {
      const email = extractEmail(row[cfg.emailField] || '');
      if (!email) continue;
      const name = row[cfg.nameField] || row[cfg.fallbackName] || 'Unknown';
      const tier = (row[cfg.tierField] || 'T3').trim();
      const status = mapStatus(row[cfg.statusField]);

      try {
        await db.query(
          `INSERT INTO contacts (contact_name, email, company, type, tier, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (email) DO UPDATE SET
             contact_name = EXCLUDED.contact_name,
             company = EXCLUDED.company,
             type = EXCLUDED.type,
             tier = EXCLUDED.tier,
             status = EXCLUDED.status,
             updated_at = NOW()`,
          [name, email, name, cfg.type, tier, status],
        );
        imported++;
      } catch (err: any) {
        logger.warn('Skip CSV row', { name, email, error: err.message });
      }
    }
  }

  let total = 0;
  try {
    const countRow = await db.query('SELECT COUNT(*) AS count FROM contacts');
    total = +(countRow.rows[0]?.count || '0');
  } catch { /* ignore */ }

  return { imported, total };
}
