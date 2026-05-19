import { type Request, type Response, Router } from 'express';
import { dbQuery } from '../database/db.js';

const router = Router();

// ── Helper: row → frontend shape ────────────────────────────────────────────────
// DB columns used here: id, contact_name, email, phone, company, tier, status,
//   outreach_status, emails_sent, last_contact_date, created_at, updated_at
function mapRow(row: Record<string, any>): Record<string, any> {
  return {
    id:           row.id,
    name:         row.contact_name || '',
    email:        row.email || '',
    phone:        row.phone || '',
    company:      row.company || '',
    tier:         row.tier || 'T3',
    status:       row.status || 'Not Started',
    outreach_status: row.outreach_status || 'none',
    emails_sent:  row.emails_sent ?? 0,
    last_contacted: row.last_contact_date
      ? new Date(row.last_contact_date).toISOString()
      : null,
    created_at:   row.created_at,
    updated_at:   row.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /contacts  –  fetch all contacts (with pagination + optional filters)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', async (req: Request, res: Response) => {
  try {
    const page     = Math.max(1, parseInt(String(req.query.page ?? '1'),  10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20));
    const offset   = (page - 1) * pageSize;

    const { search, stage, tier } = req.query;
    const params: any[] = [];
    const clauses: string[] = [];

    if (search) {
      const p = params.length + 1;
      clauses.push(`(contact_name ILIKE $${p} OR email ILIKE $${p} OR company ILIKE $${p})`);
      params.push(`%${search}%`);
    }
    if (stage) {
      const p = params.length + 1;
      clauses.push(`status = $${p}`);
      params.push(stage);
    }
    if (tier) {
      const p = params.length + 1;
      clauses.push(`tier = $${p}`);
      params.push(tier);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS cnt FROM contacts ${where}`;
    const { rows: countRows } = await dbQuery<{ cnt: string }>(countSql, params);
    const total = parseInt(countRows[0]?.cnt || '0', 10);

    const limitIdx  = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(pageSize, offset);
    const dataSql = `SELECT * FROM contacts ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const { rows } = await dbQuery(dataSql, params);

    res.json({
      success:  true,
      data:     rows.map(mapRow),
      total,
      page,
      pageSize,
    });
  } catch (err: any) {
    console.error('[contacts-db] GET / error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load contacts' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /contacts/:id  –  single contact
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { rows } = await dbQuery('SELECT * FROM contacts WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, contact: mapRow(rows[0]) });
  } catch (err: any) {
    console.error('[contacts-db] GET /:id error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load contact' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /contacts  –  create or upsert a single contact
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/', async (req: Request, res: Response) => {
  const { name, email, phone, company, title, tiertag, notes } = req.body;
  const contactName = name || req.body.contact_name || '';
  if (!email || !contactName) {
    return res.status(400).json({ success: false, error: 'Name and email are required' });
  }

  try {
    const { rows } = await dbQuery(
      `INSERT INTO contacts
         (contact_name, email, phone, company, tier, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE SET
         contact_name = EXCLUDED.contact_name,
         phone        = EXCLUDED.phone,
         company      = EXCLUDED.company,
         tier         = COALESCE(EXCLUDED.tier, contacts.tier),
         notes        = COALESCE(EXCLUDED.notes, contacts.notes),
         updated_at   = NOW()
       RETURNING *`,
      [
        contactName,
        email,
        phone || null,
        company || '',
        tiertag || 'T3',
        'Not Started',
        notes || null,
      ]
    );
    res.status(201).json({ success: true, contact: mapRow(rows[0]) });
  } catch (err: any) {
    console.error('[contacts-db] POST / error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to add contact' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /contacts/bulk  –  import an array of contacts (email required, upsert)
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/bulk', async (req: Request, res: Response) => {
  const { contacts } = req.body;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid contacts provided' });
  }
  const valid = contacts.filter((c: any) => c.email);
  if (valid.length === 0) {
    return res.status(400).json({ success: false, error: 'No contacts with email found' });
  }

  try {
    let imported = 0;
    for (const c of valid) {
      const contactName = c.name || c.contact_name || '';
      if (!contactName) continue;
      await dbQuery(
        `INSERT INTO contacts
           (contact_name, email, phone, company, tier, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO UPDATE SET
           contact_name = EXCLUDED.contact_name,
           phone        = EXCLUDED.phone,
           company      = EXCLUDED.company,
           updated_at   = NOW()`,
        [contactName, c.email, c.phone || null, c.company || '', 'T3', 'Not Started']
      );
      imported++;
    }
    // Return the fresh list so the UI can refresh immediately
    const { rows } = await dbQuery('SELECT id, contact_name, email FROM contacts ORDER BY created_at DESC LIMIT 500');
    res.json({
      success: true,
      imported,
      contacts: rows.map((r: any) => ({ id: r.id, name: r.contact_name, email: r.email })),
    });
  } catch (err: any) {
    console.error('[contacts-db] POST /bulk error:', err.message);
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /contacts/:id  –  partial update
// ═══════════════════════════════════════════════════════════════════════════════
router.put('/:id', async (req: Request, res: Response) => {
  const fields: string[] = [];
  const values: any[]   = [];
  let   idx             = 1;

  const map: Record<string, string> = {
    name:            'contact_name',
    contact_name:    'contact_name',
    outreach_status: 'outreach_status',
    status:          'status',
    tier:            'tier',
    phone:           'phone',
    company:         'company',
    emails_sent:     'emails_sent',
    last_contacted:  'last_contact_date',
    notes:           'notes',
  };

  for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
    const col = map[k];
    if (col) {
      fields.push(`${col} = $${idx++}`);
      values.push(col === 'last_contact_date' && typeof v === 'string' ? new Date(v) : v);
    }
  }
  if (fields.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

  values.push(req.params.id);
  try {
    const { rows } = await dbQuery(
      `UPDATE contacts SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, contact: mapRow(rows[0]) });
  } catch (err: any) {
    console.error('[contacts-db] PUT /:id error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update contact' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /contacts/:id
// ═══════════════════════════════════════════════════════════════════════════════
router.delete('/:id', async (_req: Request, res: Response) => {
  try {
    const { rowCount } = await dbQuery('DELETE FROM contacts WHERE id = $1', [_req.params.id]);
    if (rowCount === 0) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.status(204).send();
  } catch (err: any) {
    console.error('[contacts-db] DELETE /:id error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete contact' });
  }
});

export default router;
