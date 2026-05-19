const { Client } = require('pg');
const c = new Client({
  host: '127.0.0.1', port: 5433,
  user: 'sokogate',
  database: 'sokogate',
});
c.connect().then(async () => {
  try {
    const r1 = await c.query(`SELECT DISTINCT "type" FROM contacts LIMIT 10`);
    console.log('=== contacts.type values ===');
    r1.rows.forEach(r => console.log('  type:', JSON.stringify(r.type)));

    const r2 = await c.query(`SELECT DISTINCT tier FROM contacts LIMIT 10`);
    console.log('\n=== contacts.tier values ===');
    r2.rows.forEach(r => console.log('  tier:', JSON.stringify(r.tier)));

    const r3 = await c.query(`SELECT DISTINCT status FROM contacts LIMIT 10`);
    console.log('\n=== contacts.status values ===');
    r3.rows.forEach(r => console.log('  status:', JSON.stringify(r.status)));

    console.log('\n=== getFilteredContacts ===');
    console.log('type=prospect status=["Not Started"] tier=["T1","T2","T3"] stage=["not_started","delivered"] limit=5');

    const q = `SELECT c.id, c.company, c.type, c.tier, c.status,
                      c.do_not_contact, conv.current_stage
                 FROM contacts c
            LEFT JOIN conversations conv ON c.id::uuid = conv.contact_id
                WHERE c.type   = $1
                  AND c.status = ANY($2)
                  AND c.tier   = ANY($3)
                  AND (conv.current_stage = ANY($4) OR conv.current_stage IS NULL)
                  AND c.do_not_contact = false
             ORDER BY c.engagement_score DESC
             LIMIT $5`;
    const r4 = await c.query(q, [
      'prospect', ['Not Started'], ['T1','T2','T3'],
      ['not_started','delivered'], 5
    ]);
    console.log('rowCount:', r4.rowCount);
    r4.rows.forEach((row,i) => console.log(`  [${i}] id=${row.id} type=${row.type} tier=${row.tier} status=${row.status} do_not=${row.do_not_contact} stage=${row.current_stage}`));
  } catch (e) {
    console.error('ERROR:', e.message);
  }
  c.end();
}).catch(e => console.error(e.message));
