/**
 * batch-send.types.ts
 *
 * Shared types for the batch email send pipeline (markets, investors, partners).
 * Parsed markdown entries → CSV enrichment → sendability decisions → orchestrator call.
 */

// ── Batch File Classification ───────────────────────────────────────────────────

export type BatchCategory = 'investor' | 'partner';

export interface BatchFileMeta {
  filename:      string;
  category:      BatchCategory;
  label:         string;           // e.g. "Week 1 Cold Emails"
  companyCount:  number;           // how many entries found in the file
}

// ── Markdown-Parsed Email Entry ─────────────────────────────────────────────────

export interface ParsedEmailEntry {
  /** Zero-based ordinal within the file (Email #1 → index 0) */
  index: number;

  /** Company / fund / entity name from the heading, e.g. "Catalyst Fund" */
  companyName: string;

  /** Email address found in the entry, or null if not present */
  toEmail: string | null;

  /** Subject line extracted from **Subject**: line */
  subject: string;

  /** Full email body text (raw, before HTML conversion) */
  body: string;

  /** Raw metadata lines from the header block (tier, ticket, timeline, thesis) */
  metaLines: string[];

  /** Legacy sendability notes copied verbatim from the file header block */
  sendNotes: string[];

  /** Raw inline NHOD / verification hints found below the Email line */
  rawHints: string[];

  // ── Sendability fields (filled post-CSV merge) ────────────────────────────────

  /** Verdict computed from CSV + hints */
  decision: SendabilityDecision;

  /** Tier extracted from metaLines (e.g. "T1", "T2") */
  tier: string;

  /** Ticket size string from metaLines (e.g. "USD 500K") */
  ticket: string;

  /** Decision timeline string from metaLines (e.g. "6-8 weeks") */
  timeline: string;

  /** Investment / partnership thesis snippet */
  thesis: string;

  /** Notes field from CSV tracker (enrichment comments, follow-up history) */
  csvNotes: string;
}

// ── Sendability ─────────────────────────────────────────────────────────────────

/** Discriminated literal union of all verdict strings */
export type SendVerdict =
  | 'send'
  | 'soft-quarantine'
  | 'nhod'
  | 'no-email'
  | 'unknown';

/** Extended discriminated union: every variant carries a human-readable reason. */
export interface SendDecisionSend {
  verdict:   'send';
  /** Short label — e.g. "verified" or "email confirmed" */
  reason:    string;
}
export interface SendDecisionSoftQuarantine {
  verdict:   'soft-quarantine';
  /** Short label — e.g. "email not yet confirmed" */
  reason:    string;
}
export interface SendDecisionNhod {
  verdict:   'nhod';
  /** Hard-block justification copied from tracker notes */
  reason:    string;
}
export interface SendDecisionNoEmail {
  verdict:   'no-email';
  /** No address found in file or CSV */
  reason:    string;
}
export interface SendDecisionUnknown {
  verdict:   'unknown';
  reason:    'not assessed';
}

export type SendabilityDecision =
  | SendDecisionSend
  | SendDecisionSoftQuarantine
  | SendDecisionNhod
  | SendDecisionNoEmail
  | SendDecisionUnknown;

/** Helper: build a verdict instance inline */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function d(verdict: SendVerdict, reason: string): any {
  return { verdict, reason } as SendabilityDecision;
}

export function sendDecisionSend(reason = 'verified'): SendabilityDecision    { return d('send', reason); }
export function sendDecisionSoftQuarantine(reason = 'unverified'): SendabilityDecision { return d('soft-quarantine', reason); }
export function sendDecisionNhod(reason = 'blocked'): SendabilityDecision        { return d('nhod', reason); }
export function sendDecisionNoEmail(reason = 'no address'): SendabilityDecision  { return d('no-email', reason); }
export function sendDecisionUnknown(): SendabilityDecision                       { return d('unknown', 'not assessed'); }

export interface SendabilityContext {
  /** Do-not-send flags raised by CSV enrichment or NHOD hints */
  flags: string[];
  /** Human-friendly reason string returned to the frontend */
  reason: string;
}

// ── Send Timeline (5-contact sequence) ─────────────────────────────────────────

export interface SendTimelineEntry {
  day:        number;            // 1, 2, 3, 4, 5
  label:      string;            // e.g. "Catalyst Fund — Day 1"
  companyName: string;           // for logging / result rows
  subject:    string;
  body:       string;
  toEmail:    string;
  tier:       string;
  decision:   SendabilityDecision;
  csvNotes:   string;
}

// ── Preview / Result ────────────────────────────────────────────────────────────

export interface BatchSendPreview {
  category:      BatchCategory;
  categoryLabel: string;          // "Investor Batch" / "Partnership Batch"
  totalEntries:  number;
  sendable:      number;           // 'send' verdict
  quarantined:   number;           // 'soft-quarantine' verdict
  blocked:       number;           // 'nhod' verdict
  noEmail:       number;           // 'no-email' verdict
  entries:       ParsedEmailEntry[];
}

export interface BatchSendResult {
  success:       boolean;
  category:      BatchCategory;
  dryRun:        boolean;
  totalEntries:  number;
  sent:          number;
  failed:        number;
  skipped:       number;           // quarantined + blocked + no-email
  results: Array<{
    companyName:       string;
    toEmail?:          string;
    tier:              string;
    subject:           string;
    verdict:           SendabilityDecision;
    sendStatus?:       'sent' | 'failed' | 'dry-run' | 'skipped';
    messageId?:        string;
    error?:            string;
    sentAt?:           string;
  }>;
}

// ── CSV Enrichment ──────────────────────────────────────────────────────────────

export interface CsvEnrichment {
  companyName:      string;
  email:            string | null;
  status:           string;           // STATUS column value
  notes:            string;           // NOTES column text
  tier:             string;           // TIER column
  doNotSend:        boolean;          // true if status or notes suggest blocking
  softQuarantine:   boolean;          // true if unconfirmed but no hard blocker
}

// Made with Bob
