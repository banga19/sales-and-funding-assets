/**
 * outreach-templates.ts
 *
 * Category-scoped email templates for the automated outreach workflow.
 * Each entry is keyed by contact type: prospect | funding | partner | investor.
 *
 * Personalization tokens (filled in by OutreachBatchService before rendering):
 *   {{name}}           — contact full name
 *   {{company}}        — company / institution name
 *   {{from_name}}      — sender display name
 *   {{from_email}}     — sender email address
 *   {{platform_url}}   — sokogate.com URL
 */

export interface EmailTemplate {
  subject: string;
  html:     string;   // Rich HTML body
  text:     string;   // Plain-text fallback
}

const FROM_NAME    = 'Sokogate Sales Team';
const FROM_EMAIL   = 'sales@sokogate.com';
const PLATFORM_URL = 'https://sokogate.com';

function render(tpl: { subject: string; body: string }): EmailTemplate {
  return {
    subject: tpl.subject,
    html: tpl.body.replace(/\n/g, '<br/>'),
    text: tpl.body,
  };
}

/** Substitute {{tokens}} in a template string. */
export function fill(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => ctx[key] ?? `{{${key}}}`);
}

const ctxBase: Record<string, string> = {
  name:        '{{name}}',
  company:     '{{company}}',
  from_name:   FROM_NAME,
  from_email:  FROM_EMAIL,
  platform_url: PLATFORM_URL,
};

export const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  // ── PROSPECT ────────────────────────────────────────────────────────────────
  prospect: render({
    subject: 'Sourcing support for {{company}} — Sokogate B2B platform',
    body: [
      `Hi {{name}},`,
      '',
      'I am reaching out from Sokogate, an AI-powered B2B e-commerce platform built by Ultimo Trading Company Limited.',
      '',
      'We help construction and industrial companies like {{company}} source verified products with:',
      '  •  Clear FOB pricing in USD and KES',
      '  •  Published MOQs and air/sea freight windows',
      '  •  Supplier credentials and product certifications',
      '  •  Bulk-order discounts and volume tiers',
      '',
      'We already serve 10,000+ buyers across East and West Africa, with a 90%+ repeat-purchase rate.',
      '',
      'Would you be open to a brief conversation (15–20 min) about your current procurement priorities?',
      '',
      `Best regards,
${FROM_NAME}
${FROM_EMAIL}
${PLATFORM_URL}`,
    ].join('\n'),
  }),

  // ── FUNDING ────────────────────────────────────────────────────────────────
  funding: render({
    subject: 'Trade-finance partnership — Sokogate x {{company}}',
    body: [
      `Dear {{name}},`,
      '',
      'I hope this message finds you well. I am reaching out from Sokogate (Ultimo Trading Company Limited) to introduce a structured trade-finance opportunity that aligns with {{company}}\'s mandate.',
      '',
      'Sokogate is East Africa\'s fastest-growing B2B construction-materials marketplace, with:',
      '  •  10,000+ active buyers across 12 countries',
      '  •  ~$600K+ annual recurring revenue and 90%+ retention',
      '  •  Verified receivables and fully documented ledgers',
      '',
      'We are exploring working-capital and invoice-factoring facilities to scale cross-border supply and accelerate our Nairobi-to-Accra corridor.',
      '',
      'Could I schedule a 30-minute call to walk you through the numbers?',
      '',
      `Respectfully,
${FROM_NAME}
${FROM_EMAIL}
${PLATFORM_URL}`,
    ].join('\n'),
  }),

  // ── PARTNER ────────────────────────────────────────────────────────────────
  partner: render({
    subject: 'Logistics partnership proposal — Sokogate × {{company}}',
    body: [
      `Hi {{name}},`,
      '',
      'I am the Sales Lead at Sokogate (Ultimo Trading Company Limited), and I am excited to propose a strategic partnership with {{company}}.',
      '',
      'Sokogate ships thousands of B2B pallets monthly across Kenya, Nigeria, Ghana, and Senegal. We are looking for a logistics partner who can offer:',
      '  •  Competitive air / sea freight rates for construction materials',
      '  •  Consolidated container programmes',
      '  •  Last-mile delivery access in high-demand corridors',
      '',
      'In return, we offer:',
      '  •  A recurring, minimum-commitment monthly volume',
      '  •  Co-branding opportunities in our buyer communications',
      '  •  Revenue-sharing on preferred-lane pricing',
      '',
      'Would you be open to exploring this over a quick call this week?',
      '',
      `Looking forward to connecting,
${FROM_NAME}
${FROM_EMAIL}
${PLATFORM_URL}`,
    ].join('\n'),
  }),

  // ── INVESTOR ───────────────────────────────────────────────────────────────
  investor: render({
    subject: 'Sokogate — Series A / Growth Equity Opportunity',
    body: [
      `Dear {{name}},`,
      '',
      'I am reaching out from Sokogate (Ultimo Trading Company Limited) regarding an investment opportunity in East and West Africa\'s largest B2B construction-materials marketplace.',
      '',
      'Key highlights:',
      '  •  10,000+ active buyers and 90%+ repeat rate',
      '  •  $600K+ ARR with 3x year-on-year growth',
      '  •  Operates in Kenya, Nigeria, Ghana, Senegal — with planned expansion to 8 more markets',
      '  •  Unit economics: 35%+ gross margin, fully audited financials available',
      '',
      'We are targeting a Series A to accelerate market penetration, expand our supplier network, and deepen our AI-powered sourcing automation.',
      '',
      'I would be delighted to share our full data-room and deck at your convenience.',
      '',
      `Warm regards,
${FROM_NAME}
${FROM_EMAIL}
${PLATFORM_URL}`,
    ].join('\n'),
  }),
};
