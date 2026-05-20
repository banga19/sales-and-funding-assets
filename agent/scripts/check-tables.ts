import { db } from '../src/database/db.client';

const tables = [
  'outreach_batches','outreach_results','email_logs','marketing_assets',
  'investor_prospects','content_pieces','funding_leads','market_leads',
  'contacts','scraped_products','scrape_runs','feature_flags',
  'conversations','message_history','sub_agent_runs'
];

async function main() {
  await db.initialize();
  for (const t of tables) {
    try {
      const r = await db.query('SELECT COUNT(*) AS cnt FROM public."' + t + '"');
      console.log(t + ': ' + r.rows[0].cnt);
    } catch (e: any) {
      console.log(t + ': MISSING (' + e.message.split('\n')[0] + ')');
    }
  }
  await db.close();
}
main().catch(e => console.error(e));
