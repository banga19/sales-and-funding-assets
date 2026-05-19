const { Client } = require('pg');
const c = new Client({
  connectionString:
    'postgres://sokogate:@127.0.0.1:5433/sokogate',
});
c.connect().then(async () => {
  // Find the orchestrator and simulate with async error tracking
  const q = `SELECT c.id, c.company, c.email, c.type, c.status, c.tier
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
  console.log('rows:', r.rowCount);
  for (const row of r.rows) {
    try {
      // simulate getConversation
      const cv = await c.query('SELECT * FROM conversations WHERE contact_id = $1::uuid', [row.id]);
      const stage = cv.rows[0]?.current_stage ?? cv.rows[0]?.stage ?? null;
      console.log(`PROCESS ${row.id}: stage=${stage} skip=${stage !== null && stage !== 'not_started'} email="${row.email}"`);
    } catch (err) {
      console.log(`ERROR in loop for ${row.id}:`, err.message);
    }
  }
  c.end();
}).catch(e => console.error(e));
