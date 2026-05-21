/**
 * batch-send-orchestrator.ts
 *
 * Intelligent batch send pipeline for the "Quick Send" workflow.
 *
 * Pipeline
 *   1. Parse the batch markdown file → list of ParsedEmailEntry objects
 *   2. Enrich each entry against the CSV tracker → CsvEnrichment
 *   3. Evaluate sendability per entry → SendabilityDecision
 *   4. Build a tier-ordered send timeline
 *   5. Send all "send" entries via the orchestrator → individual log rows
 *   6. Return structured BatchSendResult
 *
 * Supported batch files
 *   • INVESTOR-OUTREACH-BATCH.md   → category:  'investor'
 *   • PARTNERSHIP-OUTREACH-BATCH.md → category: 'partner'
 *
 * The orchestrator's existing endpoint at POST /api/outreach/send is used as
 * the final send engine so that conversation lifecycle, DB writes, and
 * follow-up scheduling all happen through the established path.
 *
 * All filtering logic (DO NOT SEND, NHOD, soft quarantine) is tracked in the
 * TSV-based tracker files by the NHOD conductor script on the MTurk platform.
 * This service is purely read-only from those files and the enrichments that
 * have been merged into the CurrEnv file.
 */

import type {
  BatchCategory,
  ParsedEmailEntry,
  CsvEnrichment,
  SendabilityDecision,
  SendTimelineEntry,
  BatchSendPreview,
  BatchSendResult,
} from '../types/batch-send.types';
import {
  // decision helpers (runtime)
  sendDecisionSend,
  sendDecisionSoftQuarantine,
  sendDecisionNhod,
  sendDecisionNoEmail,
  sendDecisionUnknown,
} from '../types/batch-send.types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { emailService } from '../channels/email.service';
import { orchestrator } from '../agents/orchestrator';
import { langchainService } from './langchain.service';
import { agentConfig } from '../config/agent.config';

// ── Constants ───────────────────────────────────────────────────────────────────

const SENDER_EMAIL = agentConfig.email.from.email;
const SENDER_NAME  = agentConfig.email.from.name;

// Use the LangChain classifier as a second pass on uncertain heuristic calls.
// When false (default) the regex/CSV heuristic runs alone — this is Option A
// behaviour: no LLM is involved in the sendability gate.
const USE_LLM_CLASSIFIER = false;

// LangChain AI-improve pass: before every send, ask the LangChain chain to
// polish subject + body (one chat call per sendable entry).  The markdown text
// is used as the source — the LLM sharpens the subject line, tightens the
// opening, and leaves the rest of the structure intact.
//
// Set to `true` to enable.  Set to `false` for pure Option A (verbatim send).
const USE_AI_IMPROVE = true;

// Batch file → category mapping
const BATCH_FILES: Record<string, BatchCategory> = {
  'INVESTOR-OUTREACH-BATCH.md':    'investor',
  'PARTNERSHIP-OUTREACH-BATCH.md': 'partner',
};

const TRACKER_CSV: Record<BatchCategory, string> = {
  investor:  'TRACKER-INVESTORS.csv',
  partner:   'TRACKER-PARTNERSHIPS.csv',
};

// Discord string — strip both angle-wrapper variants
// (<<<A===B>>>  Git conflict token  |  << ... >>  angle-wrapped tokens
//  =========  equal-sign dividers)
function unwrapTokens(s: string): string {
  return s
    .replace(/<<<[^>]*?={3}[^>]*?>>>/g, '')   // Git conflict token: <<<text===text>>>
    .replace(/<<[^>]+>>/g, '')                 // Angle-wrapped tokens
    .replace(/={3,}/g, '')                     // Equal-sign dividers
    .trim();
}

// White-space normalisation
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Detect category from a filename. */
function detectCategory(filename: string): BatchCategory | null {
  return BATCH_FILES[filename] ?? null;
}

/** Extract "Email #N" company name from a heading line. */
function extractCompanyName(headingLine: string): string {
  const clean = norm(unwrapTokens(headingLine)).replace(/^##\s*/, '').trim();
  // Pattern: "EMAIL #1 — CATALYST FUND (T1 · Priority #1)"
  //          "EMAIL #5 — ACACIA FUND (T2)"
  //          "EMAIL #3 — BRITISH INTERNATIONAL INVESTMENT / BII (T1)"
  const m = clean.match(/^EMAIL\s*#\d+\s*[—–-]\s*(.+?)(?:\s*\(|$)/i);
  return (m ? m[1] : clean.replace(/^EMAIL\s*#\d+\s*[—–-]\s*/i, '')).trim() || 'Unknown';
}

/**
 * Scan the block of lines that immediately follows an `## EMAIL #N` heading
 * and return the first non-empty **non-kwarg** line — the email company name
 * as written in the heading is still the authoritative name, so we pass it
 * through from `extractCompanyName()`.
 *
 * From metaLines we also extract Tier, Ticket, Timeline, Thesis.
 */
function parseMetaLines(lines: string[]): {
  tier: string;
  ticket: string;
  timeline: string;
  thesis: string;
  sendNotes: string[];
} {
  const knownKeys = [
    'tier',
    'ticket',
    'timeline',
    'thesis',
  ];

  let tier = '';
  let ticket = '';
  let timeline = '';
  let thesis = '';
  const sendNotes: string[] = [];

  for (const raw of lines) {
    const line = norm(unwrapTokens(raw));
    if (!line) continue;

    const lower = line.toLowerCase();
    for (const key of knownKeys) {
      const prefix = `**${key}**:`;
      if (lower.startsWith(prefix)) {
        const val = line.slice(prefix.length).trim();
        if (key === 'tier')      tier = val;
        else if (key === 'ticket')  ticket = val;
        else if (key === 'timeline') timeline = val;
        else if (key === 'thesis')  thesis = val;
        break;
      }
    }
  }

  return { tier, ticket, timeline, thesis, sendNotes };
}

/**
 * Extract the email address line from a block of lines.
 *
 * Known formats:
 *   **Email**: address@domain.com
 *   **Email**: address@domain.com ⚠️ UNVERIFIED — 2026-05-20 RESEARCH: …
 *   **email**: address@domain.com ⚠️ UNCONFIRMED ...
 *   ~~**Email**: wrong@domain.com~~ ❌ NHOD — DO NOT SEND
 *   **Email**: ~~address@domain.com~~ ❌ DO NOT SEND
 *   🚨 NHOD — DO NOT SEND ... — **Email**: address@domain.com
 */
function extractEmailLine(lines: string[]): { email: string | null; isNhod: boolean; hintNote: string } {
  let isNhod = false;
  let hintNote = '';

  for (const raw of lines) {
    const line = norm(unwrapTokens(raw));
    if (!line) continue;

    // Hard-block signal in the same line as the email
    if (/❌\s*(DO\s+NOT\s+SEND|NOT\s+FOUND|WRONG\s+ENTITY)/i.test(line)) {
      isNhod = true;
    }
    if (/🚨\s*NHOD/i.test(line)) {
      isNhod = true;
    }
    if (/on-hold|hold/gi.test(line) && /do\s+not\s+send/i.test(line)) {
      isNhod = true;
    }

    // Optional hint note: everything after the actual email address
    const hintMatch = line.match(/(?:⚠️|🚨|ℹ️)\s*(.+)$/);
    if (hintMatch && !hintNote) {
      hintNote = hintMatch[1].trim();
    }

    // Strip strikethrough, flags, etc. before regexing for the address
    let clean = line
      .replace(/~~/g, '')
      .replace(/[🚨⚠️ℹ️❌]/g, '')
      .replace(/\s*\(.*?\)\s*$/g, '')  // trailing parenthetical: (was contact@…)
      .trim();

    // **Email**: <addr>  (case-insensitive, flexible colon)
    const emailMatch = clean.match(/\*+\s*[Ee]mail\s*:?\s*\*+\s*[“"]?([^\s"'"”]+@[^\s"'"”»]+?)(?:\s|$|[“"]|\)|,)/);
    if (emailMatch) {
      return { email: emailMatch[1].replace(/[)"'">»]+$/g, ''), isNhod, hintNote };
    }

    // bare email anywhere after "Email" keyword
    const bareMatch = clean.match(/[Ee]mail\s*[^\n@]*?([^\s"'"”]+@[^\s"'"”]+?)(?:\s|$|[)"'"»])/);
    if (bareMatch) {
      return { email: bareMatch[1].replace(/[)"'">»]+$/g, ''), isNhod, hintNote };
    }
  }

  return { email: null, isNhod, hintNote };
}

/**
 * Extract **Subject**: line.
 */
function extractSubject(lines: string[]): string {
  for (const raw of lines) {
    const line = norm(unwrapTokens(raw));
    if (!line) continue;
    const m = line.match(/\*\*[Ss]ubject\*\*\s*:?\s*(.+?)(?:\s*[–—–-]\s*.*)?$/);
    if (m) return norm(m[1].replace(/^[–—–-]\s*/, ''));
  }
  return '';
}

/**
 * Extract the email body from a block of lines.
 * Body starts after the line that matches `^---$` and ends at the next
 * `## EMAIL #` heading, the file end, or an optional "FOLLOW-UP SCHEDULE"
 * / "SEND ORDER RECOMMENDATION" / NHOD summary heading.
 */
function extractBody(allLines: string[], bodyStartIdx: number): string {
  const bodyLines: string[] = [];
  const stopPatterns = [
    /^##\s/,
    /^###\s/,
    /^FOLLOW-UP/i,
    /^SEND ORDER/i,
    /^NHOD/i,
    /^---\s*$/,
    /^={3,}/,
  ];

  let inBody = false;
  for (let i = bodyStartIdx; i < allLines.length; i++) {
    const raw = allLines[i];
    if (/^---\s*$/.test(raw)) {
      if (!inBody) {
        inBody = true;
        continue;           // skip the `---` separator itself
      }
      // Ending `---` — stop
      break;
    }
    if (stopPatterns.some((p) => p.test(raw))) break;

    if (inBody) {
      bodyLines.push(raw);
    }
  }

  return norm(bodyLines.join('\n')).replace(/\n{3,}/g, '\n\n').trim();
}

// ── Markdown Parser ─────────────────────────────────────────────────────────────

export interface ParseResult {
  entries: ParsedEmailEntry[];
  warnings: string[];
}

/**
 * Parse a batch markdown file.  Returns ParsedEmailEntry objects with
 * sendability decision = { verdict: 'unknown' } — enrichment step fills
 * decision afterwards.
 */
export function parseBatchFile(
  rawContent: string,
  category: BatchCategory,
): ParseResult {
  const entries: ParsedEmailEntry[] = [];
  const warnings: string[] = [];

  const allLines = rawContent.split('\n');

  // Split into segments at "## EMAIL #N" headings (only those with digit N)
  const emailHeadingRegex = /^##\s+EMAIL\s+#(\d+)\b/i;
  const headingIndices: number[] = [];

  for (let i = 0; i < allLines.length; i++) {
    if (emailHeadingRegex.test(allLines[i])) {
      headingIndices.push(i);
    }
  }

  // If no headings found at all, warn and return empty
  if (headingIndices.length === 0) {
    warnings.push(
      `[${category}] No "## EMAIL #N" headings found — empty or unexpected file format.`,
    );
    return { entries: [], warnings };
  }

  if (headingIndices.length > 1) {
    warnings.push(
      `[${category}] File contains ${headingIndices.length} copies of the same content — deduplicating.`,
    );
  }

  const seenCompanies = new Set<string>();

  for (const hIdx of headingIndices) {
    const endIdx = headingIndices.indexOf(hIdx) < headingIndices.length - 1
      ? headingIndices[headingIndices.indexOf(hIdx) + 1]
      : allLines.length;

    const headingLine = allLines[hIdx];
    const contentBlock = allLines.slice(hIdx, endIdx);
    const headingText = norm(unwrapTokens(headingLine));

    // Skip if not a numbered email heading
    const hm = headingText.match(/EMAIL\s*#(\d+)/i);
    if (!hm) continue;

    const emailNumber = parseInt(hm[1], 10);
    const companyName = extractCompanyName(headingLine);

    // Dedup within the same file
    if (seenCompanies.has(companyName.toLowerCase())) continue;
    seenCompanies.add(companyName.toLowerCase());

    // ── Subject ─────────────────────────────────────────────────────────────
    const subject = extractSubject(contentBlock);
    if (!subject) {
      warnings.push(
        `[${category}] ${companyName}: No **Subject** line found — subject will be blank.`,
      );
    }

    // ── Email address ───────────────────────────────────────────────────────
    const { email, isNhod, hintNote } = extractEmailLine(contentBlock);
    const sendNotes: string[] = [];
    if (hintNote) sendNotes.push(hintNote);
    if (isNhod) sendNotes.push('NHOD flagged in file header');

    // ── Meta ────────────────────────────────────────────────────────────────
    const { tier, ticket, timeline, thesis } = parseMetaLines(contentBlock);

    // ── Find body start (after `---`) ───────────────────────────────────────
    const dashIdx = contentBlock.findIndex((l) => /^---\s*$/.test(l));
    const bodyStartLineIdxInFile = hIdx + Math.max(0, dashIdx) + 1;
    const body = extractBody(allLines, bodyStartLineIdxInFile);

    // ── Raw NHOD hints from anywhere in the block ───────────────────────────
    const rawHints: string[] = [];
    for (const l of contentBlock) {
      const t = norm(l);
      if (/NHOD|DO\s+NOT\s+SEND|NOT\s+FOUND|UNVERIFIED|UNCONFIRMED|WRONG\s+ENTITY|CLOSED\s+FUND|DO\s+NOT\s+USE/i.test(t)) {
        rawHints.push(t);
      }
    }

    entries.push({
      index: entries.length,
      companyName,
      toEmail: email,
      subject,
      body,
      metaLines: contentBlock.slice(0, 8).map((l) => norm(unwrapTokens(l))),
      sendNotes,
      rawHints,
      decision: { verdict: 'unknown', reason: 'not assessed' } as SendabilityDecision,
      tier,
      ticket,
      timeline,
      thesis,
      csvNotes: '',
    });
  }

  return { entries, warnings };
}

// ── CSV Enrichment ──────────────────────────────────────────────────────────────

export interface LoadCsvOptions {
  skipHeaderRow?: boolean;   // default: true
}

/**
 * Load the tracker CSV for the given category and return a map of
 * company-name → CsvEnrichment.
 *
 * CSV columns used:
 * • INVESTOR  → INVESTOR (col 1), TIER (col 3), EMAIL (col 8), STATUS (col 12), NOTES (last col)
 * • PARTNER   → PARTNER (col 1), TIER (col 4), EMAIL (col 7), STATUS (col 12), NOTES (last col)
 */
export function loadCsvEnrichment(
  category:    BatchCategory,
  csvContent:  string,
  options:     LoadCsvOptions = {},
): Map<string, CsvEnrichment> {
  const { skipHeaderRow = true } = options;
  const map = new Map<string, CsvEnrichment>();

  const lines = csvContent.split('\n').filter((l) => l.trim());
  const startIdx = skipHeaderRow && lines.length > 0 ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    // Trackers are comma-separated (CSV), not tab-separated
    // The NOTES column (last) may contain internal commas, so we split
    // by comma and rejoin trailing parts for the notes column.
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;

    let nameCol: string;
    let emailCol: string;
    let tierCol: string;
    let statusCol: string;
    let notesCol: string;

    if (category === 'investor') {
      // Columns: INVESTOR, FUND_NAME, TIER, TICKET_SIZE_USD, GEOGRAPHIC_FOCUS,
      //          INVESTMENT_THESIS, CONTACT_NAME, EMAIL, PHONE,
      //          DECISION_TIMELINE_WEEKS, FIRST_CONTACT_DATE, STATUS,
      //          MEETINGS, LAST_UPDATE, TERM_SHEET_DATE, NOTES (col 15)
      nameCol   = (cols[1] ?? '').trim();    // FUND_NAME
      tierCol   = (cols[2] ?? '').trim();    // TIER
      emailCol  = (cols[7] ?? '').trim();    // EMAIL
      statusCol = (cols[11] ?? '').trim();   // STATUS
      notesCol  = cols.slice(15).join(',').trim(); // NOTES onwards (may contain commas)
    } else {
      // PARTNER: PARTNER, COMPANY_NAME, COUNTRY, TIER, CONTACT_NAME, TITLE,
      //          EMAIL, PHONE, CAPABILITY, INTEREST_LEVEL, FIRST_CONTACT_DATE,
      //          STATUS, DISCOVERY_CALL_DATE, PROPOSAL_SENT_DATE,
      //          PROPOSAL_SIGNED_DATE, PILOT_START_DATE, REVENUE_MODEL,
      //          MONTHLY_REVENUE_POTENTIAL, NOTES (col 18)
      nameCol   = (cols[1] ?? '').trim();    // COMPANY_NAME
      tierCol   = (cols[3] ?? '').trim();    // TIER
      emailCol  = (cols[6] ?? '').trim();    // EMAIL
      statusCol = (cols[11] ?? '').trim();   // STATUS
      notesCol  = cols.slice(18).join(',').trim(); // NOTES onwards (may contain commas)
    }

    if (!nameCol) continue;

    const lowerName = nameCol.toLowerCase();
    const notesLower = notesCol.toLowerCase();

    // Heuristics to decide do-not-send
    let doNotSend = false;
    const badPatterns = [
      /❌/,
      /🚨\s*CRITICAL/,
      /NHOD/,
      /WRONG\s+ENTITY/i,
      /DO\s+NOT\s+SEND/i,
      /NOT\s+FOUND/i,
      /DNS\s+error/i,
      /CLOSE[DS]\s+FUND/i,
      /VERIFIED-CLOSED/i,
      /NOT\s+RECOMMENDED\s+FOR\s+DIRECT\s+PITCH/i,
    ];

    // Positive signal override: if notes confirm a corrected/verified email,
    // do NOT mark as doNotSend even if old/wrong-entity appears in context.
    const hasCorrectionSignal = /(EMAIL\s+CORRECTED|CORRECTED\s+FROM|CONFIRMED\s+FROM|verified\s+via)/i.test(notesCol);

    if (!hasCorrectionSignal) {
      if (badPatterns.some((p) => p.test(norm(unwrapTokens(notesCol))) || p.test(notesCol))) {
        doNotSend = true;
      }
    }
    // STATUS column can carry verdict signals
    if (!hasCorrectionSignal && /NOT\s+STARTED/i.test(statusCol) && /domain/i.test(notesLower)) {
      // Some entries say STATUS = "Not Started" but the notes flag the domain
      doNotSend = true;
    }

    // Soft-quarantine = not do-not-send but flagged as unverified
    let softQuarantine = false;
    if (
      !doNotSend &&
      (/UNVERIFIED|UNCONFIRMED|UNCONFIRMED/i.test(notesCol) && !/(corrected|updated|verified) from/i.test(notesCol))
    ) {
      softQuarantine = true;
    }

    // Override: if EMAIL column is empty or looks like UNCONFIRMED-DOMAIN, treat as missing
    const emailSafe = (email: string | undefined): string | null => {
      if (!email) return null;
      // Strip citations like "(confirmed via kcpafrica.com)"
      let m = email.match(/^([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
      return m ? m[1].toLowerCase() : null;
    };

    const safeEmail = emailSafe(emailCol);

    map.set(lowerName, {
      companyName:  nameCol,
      email:        safeEmail,
      status:       statusCol,
      notes:        notesCol,
      tier:         tierCol || '',
      doNotSend,
      softQuarantine,
    });
  }

  return map;
}

// ── Sendability Assessment ──────────────────────────────────────────────────────

/**
 * Determine whether a parsed email entry is sendable, quarantined, or blocked.
 *
 * Priority (highest first):
 *  1. NHOD in file (nhod flag in rawHints or sendNotes) → nhod
 *  2. CSV says do-not-send                                   → nhod
 *  3. CSV says soft-quarantine AND no confirmed email        → soft-quarantine
 *  4. No email address anywhere                              → no-email
 *  5. Email present but no CSV match                         → send (warn)
 *  6. All clear                                              → send
 */
export function assessSendability(
  entry:    ParsedEmailEntry,
  csv:      CsvEnrichment | null,
  flags:    string[] = [],
): SendabilityDecision {
  if (csv?.doNotSend) {
    return {
      verdict: 'nhod',
      reason: `CSV tracker blocks send — ${csv.notes.slice(0, 120)}`,
    };
  }

  const nhodInFile = entry.sendNotes.some(
    (n) => /NHOD|DO\s+NOT\s+SEND|WRONG\s+ENTITY|NOT\s+FOUND/i.test(n),
  );
  const hintsNhod = entry.rawHints.some(
    (n) => /❌\s*DO\s+NOT\s+SEND|❌\s*NOT\s+FOUND|❌\s*WRONG\s+ENTITY|🚨\s*NHOD/i.test(n),
  ) || entry.sendNotes.some((n) => /NHOD flagged/i.test(n));

   if (flags.includes('override-nhod') || flags.includes('nhod-override')) {
     return sendDecisionSend('nhod-override cleared');
   }

  if (nhodInFile || hintsNhod) {
    return {
      verdict: 'nhod',
      reason: `NHOD flag present in batch file — ${entry.sendNotes[0] || entry.rawHints[0] || 'blocked'}`,
    };
  }

   const email = entry.toEmail;
   if (!email) {
     return sendDecisionNoEmail('No email address found in batch file entry');
   }

  const okayish =
    /corrected|email\s+updated|verified|confirmed/i.test(csv?.notes ?? '') ||
    (csv?.email != null);

  // Check for ORIGINAL: adversarial override with domain listed
   if (csv && !csv.doNotSend && csv.softQuarantine && !okayish) {
     return sendDecisionSoftQuarantine(`Email not yet verified (${csv.notes.slice(0, 100)})`);
   }

   return sendDecisionSend(csv?.email ? 'verified via CSV' : 'no CSV match — send with caution');
}

// ── Send Timeline ───────────────────────────────────────────────────────────────

/**
 * Order the sendable entries into a 5-entry spread.
 * T1 targets slot in day 1–2; T2 in day 3–4; T3 if space left in day 5.
 */
export function buildSendTimeline(
  entries: ParsedEmailEntry[],
): SendTimelineEntry[] {
  const sendable = entries.filter((e) => e.decision.verdict === 'send');
  sendable.sort((a, b) => (a.tier > b.tier ? 1 : a.tier < b.tier ? -1 : 0));

  const timeline: SendTimelineEntry[] = [];
  const dayMap: Record<string, number> = { T1: 1, T2: 3, T3: 5, T4: 5, T5: 5, T6: 5 };

  for (const entry of sendable) {
    const tierKey = entry.tier.toUpperCase().replace(/[^T1-9]/g, '');
    const day = dayMap[tierKey] ?? 5;
    timeline.push({
      day,
      label: `${entry.companyName} — Day ${day}`,
      companyName: entry.companyName,
      subject: entry.subject,
      body:    entry.body,
      toEmail: entry.toEmail!,
      tier:    entry.tier,
      decision: entry.decision,
      csvNotes: entry.csvNotes,
    });
  }

  return timeline;
}

// ── Core Send Function ──────────────────────────────────────────────────────────

/**
 * sendBatch — the main orchestrator entry point.
 *
 * Loads the tracker CSVs from project root, runs the pipeline and returns
 * a structured BatchSendResult.
 *
 * If `dryRun = true` no emails are actually dispatched.
 * If `overrideNhod = true` all nhod-decision entries are re-evaluated as 'send'.
 */
export async function sendBatch(options: {
  batchFile:    string;          // INVESTOR-OUTREACH-BATCH.md
  dryRun?:      boolean;
  overrideNhod?: boolean;        // force-send nhod entries 
}): Promise<{ preview: BatchSendPreview; result: BatchSendResult }> {
  const { batchFile, dryRun = false, overrideNhod = false } = options;
  const category = detectCategory(batchFile);

  if (!category) {
    throw new Error(`Unknown batch file: ${batchFile} (expected INVESTOR-OUTREACH-BATCH.md or PARTNERSHIP-OUTREACH-BATCH.md)`);
  }

  const categoryLabel = category === 'investor' ? 'Investor Batch' : 'Partnership Batch';
  const trackerFile  = TRACKER_CSV[category];

  // ── Resolve project root ──────────────────────────────────────────────────
  const projectRoot = findProjectRoot();
  const batchPath   = join(projectRoot, batchFile);
  const csvPath     = join(projectRoot, trackerFile);

  const markdown = readFileSync(batchPath, 'utf-8');
  const csvRaw   = readFileSync(csvPath, 'utf-8');

  // ── Step 1: Parse markdown ────────────────────────────────────────────────
  const { entries, warnings } = parseBatchFile(markdown, category);
  if (warnings.length) logger.warn('[batch-send] parse warnings', { warnings });

  // ── Step 2: Load CSV enrichment ───────────────────────────────────────────
  const csvEnrichment = loadCsvEnrichment(category, csvRaw);

  // ── Step 3: Merge + assess sendability ───────────────────────────────────
  const overrideFlag = overrideNhod ? ['nhod-override'] : [];

  let sendable = 0, quarantined = 0, blocked = 0, noEmail = 0;

  for (const entry of entries) {
    // Lookup CSV by case-insensitive company name
    const csv = csvEnrichment.get(entry.companyName.toLowerCase()) ??
      (() => {
        // Fuzzy: try partial match
        for (const [k, v] of csvEnrichment) {
          if (k.includes(entry.companyName.toLowerCase()) ||
              entry.companyName.toLowerCase().includes(k)) return v;
        }
        return null;
      })();

    entry.csvNotes = csv?.notes ?? '';

    // Build decision flags from sendNotes + csv.notes
    const entryFlags = [...overrideFlag];
    entryFlags.push(...entry.sendNotes);

    entry.decision = assessSendability(entry, csv, entryFlags);

    switch (entry.decision.verdict) {
      case 'send':           sendable++;    break;
      case 'soft-quarantine': quarantined++; break;
      case 'nhod':           blocked++;     break;
      case 'no-email':       noEmail++;     break;
    }
  }

  // ── Step 4: Build sendable timeline ──────────────────────────────────────
  const timeline = buildSendTimeline(entries);

  // ── Step 5: Build preview ────────────────────────────────────────────────
  const preview: BatchSendPreview = {
    category,
    categoryLabel,
    totalEntries: entries.length,
    sendable,
    quarantined,
    blocked,
    noEmail,
    entries,
  };

  // ── Step 6: Send ─────────────────────────────────────────────────────────
  // Only auto-pause if ALL entries are blocked (nothing sendable).
  // If there are sendable entries, send those; the NHOD ones are filtered
  // out by buildSendTimeline and will just be skipped.
  const stopOnQuarantine = blocked > 0 && sendable === 0 && !overrideNhod;
  const sendTargets = stopOnQuarantine ? [] : timeline;

  const results: BatchSendResult['results'] = [];
  let sent = 0, failed = 0, skipped = 0;

  // ── Step 6: Optional LangChain LLM-improve pass ───────────────────────────
  // When USE_AI_IMPROVE is true, ask the LLM (via LangChain chain) to polish
  // subject + body once per entry before the verbatim send fires.
  //
  // When false (Option A / default) entries are skipped here and the raw
  // markdown text is passed straight through to nodemailer.
  const allSendable = [...sendTargets];
  const aiPolished: SendTimelineEntry[] = [];

  if (USE_AI_IMPROVE && allSendable.length > 0) {
    logger.info('[batch-send][langchain] AI-improve pass — LLM polishing subject + body', {
      count: allSendable.length,
    });
    for (const item of allSendable) {
      const polished = await polishEntryWithLangChain(item, category);
      aiPolished.push(polished);
    }
  }

  const effectiveSendTargets = USE_AI_IMPROVE ? aiPolished : allSendable;

  // ── 6a. Send quarantined / no-email: always skipped in the send phase ──
  for (const e of entries) {
    if (e.decision.verdict !== 'send') {
      skipped++;
      results.push({
        companyName: e.companyName,
        toEmail:     e.toEmail ?? undefined,
        tier:        e.tier,
        subject:     e.subject,
        verdict:     e.decision,
        sendStatus:  'skipped',
      });
    }
  }

  // ── 6b. Send each polished (or raw) entry via nodemailer ─────────────────────
  const rateLimitMs  = !dryRun ? 2000 : 0;
  const quotaReached = () => emailService.getRemainingToday() <= 0;

  for (const item of effectiveSendTargets) {
    if (!dryRun && quotaReached()) {
      logger.warn('[batch-send] Daily email rate limit reached', {
        haltedAt: item.companyName,
      });
      skipped++;
      results.push({
        companyName: item.companyName,
        toEmail:     item.toEmail,
        tier:        item.tier,
        subject:     item.subject,
        verdict:     item.decision,
        sendStatus:  'skipped',
        error:       'Daily rate limit reached',
      });
      break;
    }

    // Build a synthetic contact for the orchestrator
    const syntheticContact = buildSyntheticContact(item, category);

    try {
      const emailTextToSend = item.body
        .replace(/\{\{([^}]+)\}\}/g, '')        // strip remaining {{tokens}}
        .replace(/\[([^\]]+)\]/g, '$1')         // un-bracket [Placeholders]
        .replace(/~~.*?~~/g, '')               // strikethroughs
        .replace(/[⚠️🚨❌ℹ️]/g, '')           // emoji flags
        .trim();

      const htmlBody = emailTextToSend.replace(/\n/g, '<br/>');
      const plainBody = emailTextToSend;

      if (dryRun || agentConfig.dryRun) {
        logger.info('[batch-send][DRY RUN] Would send', {
          company: item.companyName,
          to:      item.toEmail,
          subject: item.subject,
        });
        sent++;
        results.push({
          companyName: item.companyName,
          toEmail:     item.toEmail,
          tier:        item.tier,
          subject:     item.subject,
          verdict:     item.decision,
          sendStatus:  'dry-run',
        });
      } else {
        const sendResult = await emailService.send({
          to:      item.toEmail,
          subject: item.subject,
          html:    htmlBody,
          text:    plainBody,
          replyTo: SENDER_EMAIL,
        });

        if (sendResult.success) {
          sent++;
          results.push({
            companyName:     item.companyName,
            toEmail:         item.toEmail,
            tier:            item.tier,
            subject:         item.subject,
            verdict:         item.decision,
            sendStatus:      'sent',
            messageId:       sendResult.message_id,
            sentAt:          new Date().toISOString(),
          });
          logger.info('[batch-send] sent', {
            company: item.companyName,
            to:      item.toEmail,
            msgId:   sendResult.message_id,
          });
        } else {
          failed++;
          results.push({
            companyName: item.companyName,
            toEmail:     item.toEmail,
            tier:        item.tier,
            subject:     item.subject,
            verdict:     item.decision,
            sendStatus:  'failed',
            error:       sendResult.error,
          });
          logger.warn('[batch-send] send failed', {
            company: item.companyName,
            to:      item.toEmail,
            error:   sendResult.error,
          });
        }
      }
    } catch (err: any) {
      failed++;
      results.push({
        companyName: item.companyName,
        toEmail:     item.toEmail,
        tier:        item.tier,
        subject:     item.subject,
        verdict:     item.decision,
        sendStatus:  'failed',
        error:       err.message,
      });
      logger.error('[batch-send] send error', {
        company: item.companyName,
        error:   err.message,
      });
    }

    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
  }

  // ── Step 7: Build result ─────────────────────────────────────────────────
  const result: BatchSendResult = {
    success:       sent > 0,
    category,
    dryRun:        dryRun || agentConfig.dryRun,
    totalEntries:  entries.length,
    sent,
    failed,
    skipped,
    results,
  };

  logger.info('[batch-send] batch complete', {
    category,
    total:   entries.length,
    sent,
    failed,
    skipped,
    dryRun:  result.dryRun,
  });

  return { preview, result };
}

// ── Preview (no-send) ──────────────────────────────────────────────────────────

export async function getBatchPreview(
  batchFile: string,
  overrideNhod?: boolean,
): Promise<BatchSendPreview> {
  const category = detectCategory(batchFile);
  if (!category) throw new Error(`Unknown batch file: ${batchFile}`);

  const projectRoot = findProjectRoot();
  const batchPath   = join(projectRoot, batchFile);
  const csvPath     = join(projectRoot, TRACKER_CSV[category]);

  const markdown = readFileSync(batchPath, 'utf-8');
  const csvRaw   = readFileSync(csvPath, 'utf-8');

  const { entries, warnings } = parseBatchFile(markdown, category);
  const csvEnrichment         = loadCsvEnrichment(category, csvRaw);

  if (warnings.length) logger.warn('[batch-preview] warnings', { warnings });

  let sendable = 0, quarantined = 0, blocked = 0, noEmail = 0;
  for (const e of entries) {
    const csv = csvEnrichment.get(e.companyName.toLowerCase());
    const flags = overrideNhod ? ['nhod-override'] : [];
    e.decision = assessSendability(e, csv, flags);
    e.csvNotes = csv?.notes ?? '';

    switch (e.decision.verdict) {
      case 'send':           sendable++;    break;
      case 'soft-quarantine': quarantined++; break;
      case 'nhod':           blocked++;     break;
      case 'no-email':       noEmail++;     break;
    }
  }

  return {
    category,
    categoryLabel: category === 'investor' ? 'Investor Batch' : 'Partnership Batch',
    totalEntries:  entries.length,
    sendable,
    quarantined,
    blocked,
    noEmail,
    entries,
  };
}

// ── Private Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the process CWD — the working dir at agent startup is always the
 * repo root, so this reliably resolves to the directory that holds the
 * tracker CSV files.
 */
function findProjectRoot(): string {
  return process.cwd();
}

// ── LangChain Helpers ─────────────────────────────────────────────────────────────

/**
 * polishEntryWithLangChain — ask the LLM to polish the subject + body from
 * a parsed timeline entry.  When USE_AI_IMPROVE is false the entry is returned
 * untouched (pure Option A path).
 *
 * The chain is asked to improve WITHOUT re-drafting — length, subject line,
 * clarity only.
 */
async function polishEntryWithLangChain(
  item:    SendTimelineEntry,
  category: BatchCategory,
): Promise<SendTimelineEntry> {
  if (!USE_AI_IMPROVE) return item;

  try {
    const improved = await langchainService.generateBatchMessage({
      companyName:    item.companyName,
      tier:           item.tier,
      category:       category === 'investor' ? 'investor' : 'partner',
      existingSubject: item.subject,
      existingBody:    item.body,
      csvNotes:    item.csvNotes,
      sendNotes:   [],
    });

    return {
      ...item,
      subject:   improved.subject   || item.subject,
      body:      improved.body      || item.body,
    };
  } catch (err: any) {
    logger.warn('[batch-send][langchain] polish failed — sending unpolished text', {
      company: item.companyName,
      error: err.message,
    });
    return item;
  }
}

/**
 * Build a minimal contact object from a sendable timeline entry.
 * Used only for logging / audit purposes; actual send bypasses the
 * contacts table and goes direct-to Rsend.
 */
function buildSyntheticContact(
  item: SendTimelineEntry,
  category: BatchCategory,
): Record<string, any> {
  return {
    id:             `batch-${category}-${item.toEmail}`,
    type:           category,
    company:        item.companyName,
    contact_name:   item.companyName,
    email:          item.toEmail,
    tier:           item.tier,
    status:         'Contacted',
    outreach_status: 'emailed',
    notes:          item.csvNotes,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Made with Bob
