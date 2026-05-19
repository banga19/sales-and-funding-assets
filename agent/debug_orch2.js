const { Client } = require('pg');
const c = new Client({
  connectionString:
    'postgres://sokogate:@127.0.0.1:5433/sokogate',
});
c.connect().then(async () => {
  // Step 1: get the exact IDs after the filter
  const q = `SELECT c.id, c.company, c.email, c.type, c.status, c.tier, c.do_not_contact, conv.current_stage
     FROM contacts c
LEFT JOIN conversations conv ON c.id::uuid = conv.contact_id
    WHERE c.type   = $1
      AND c.status = ANY($2)
      AND c.tier   = ANY($3)
      AND (conv.current_stage = ANY($4) OR conv.current_stage IS NULL)
      AND c.do_not_contact = false
   ORDER BY c.engagement_score DESC
   LIMIT $5`;
  const r = await c.query(q, [
    'prospect', ['Not Started'], ['T1','T2','T3'],
    ['not_started','delivered'], 5
  ]);
  console.log('=== Step 1: query result ===');
  console.log('rowCount:', r.rowCount);
  r.rows.forEach((row, i) => {
    console.log(` contact[${i}]: id=${row.id} company="${row.company}" email="${row.email}"`);
  });

  // Step 2: call getConversation() for each returned contact, just like the orchestrator
  for (const row of r.rows) {
    const convRow = await c.query('SELECT * FROM conversations WHERE contact_id = $1::uuid', [row.id]);
    const conv = convRow.rows[0];
    const stage = conv?.current_stage ?? conv?.stage ?? null;
    console.log(`\n contact ${row.id}: stage from getConversation = ${stage}`);
    console.log(`   skipCondition: stage !== null && stage !== 'not_started' = ${stage !== null && stage !== 'not_started'}`);
    console.log(`   would_process: ${!(stage !== null && stage !== 'not_started')}`);
  }
  c.end();
}).catch(e => console.error(e));
