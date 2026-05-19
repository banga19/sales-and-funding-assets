const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: '127.0.0.1', port: 5433,
    user: 'sokogate', database: 'sokogate',
  });
  await c.connect();
  try {
    const classes = ['Not Started', 'active', 'Active', 'not_started', 'new'];
    const q = `SELECT DISTINCT status FROM contacts ORDER BY 1 LIMIT 20`;
    const r = await c.query(q);
    console.log('=== Distinct contact.status values ===');
    for (const row of r.rows) {
      console.log('  ', JSON.stringify(row.status), '  (len=' + (row.status||'').length + ')');
    }
  } catch (e) {
    console.error(e.message);
  }
  c.end();
}

main().catch(e => console.error(e));
