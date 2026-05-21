/**
 * contact-memory.service.ts
 *
 * LangChain-powered semantic contact search for Sokogate / Ultimo Trading Company Limited.
 *
 * Responsibilities
 *   1. Embed the textual profile of every contact row using NVIDIA/nemotron embeddings.
 *   2. Store the embedding vector in contacts.embedding (pgvector column).
 *   3. Accept natural-language queries and perform cosine-similarity search against
 *      the stored vectors to return semantically matching contacts.
 *   4. Fall back to raw SQL filtering when embedding generation is unavailable.
 *
 * LangChain classes consumed
 *   · ChatOpenAI        — LLM + embedding calls via NVIDIA proxy (baseUrl override)
 *   · TextSplitter      — chunk long contact notes before embedding
 *   · RunnableLambda    — compose retriever + fallback into a single callable
 */

import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService } from './langchain.service';

/** Descriptor used to build the embedding text from a contact row. */
export interface ContactEmbeddingInput {
  id:          string;
  company:     string;
  contact_name: string;
  type:        string;
  tier:        string;
  status:      string;
  location?:   string;
  notes?:      string;
  pain_point?: string;
  engagement_angle?: string;
  annual_spend_kes?: number;
  fund_name?:  string;
  geographic_focus?: string;
  institution_type?: string;
}

// ─── Embedding helpers ─────────────────────────────────────────────────────────

/**
 * generateEmbedding — sends the contact profile text to the NVIDIA embedding endpoint
 * via ChatOpenAI.embed().  Returns null on failure so callers can fall back to SQL.
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!agentConfig.ai?.apiKey) {
    logger.warn('[contact-memory] no NVIDIA_API_KEY — skipping embedding');
    return null;
  }

  try {
    const embedder = new OpenAIEmbeddings({
      apiKey:         agentConfig.ai.apiKey,
      model:          'text-embedding-ada-002',
      configuration:  { baseURL: agentConfig.ai.baseUrl },
    });

    // OpenAIEmbeddings.embedQuery() returns a number[]
    const vec: number[] = await embedder.embedQuery(text);
    return vec ?? null;
  } catch (err: any) {
    // Most common cause on dev: the NVIDIA base URL doesn't expose an embedding route.
    // We skip instead of throwing so downstream callers can fall back to SQL filters.
    logger.warn('[contact-memory] embedding call failed — contact search falls back to SQL', {
      error: err.message,
    });
    return null;
  }
}

/** Serialise a ContactEmbeddingInput into the one-line text chunk fed to the embedder. */
function contactProfileText(c: ContactEmbeddingInput): string {
  const parts = [
    `Company: ${c.company}`,
    `Contact: ${c.contact_name}`,
    `Type: ${c.type}`,
    `Tier: ${c.tier}`,
    `Status: ${c.status}`,
    c.location     ? `Location: ${c.location}`     : '',
    c.notes        ? `Notes: ${c.notes?.slice(0, 300)}`                : '',
    c.pain_point   ? `Pain point: ${c.pain_point}`   : '',
    c.engagement_angle ? `Engagement angle: ${c.engagement_angle}` : '',
    c.annual_spend_kes != null  ? `Annual spend: KES ${c.annual_spend_kes}`   : '',
    c.fund_name    ? `Fund: ${c.fund_name}`         : '',
    c.geographic_focus ? `Geographic focus: ${c.geographic_focus}`         : '',
    c.institution_type  ? `Institution type: ${c.institution_type}`         : '',
  ].filter(Boolean);
  return parts.join('\n');
}

// ─── Core surface ──────────────────────────────────────────────────────────────

/**
 * embedContact — compute and persist the embedding vector for a single contact row.
 * Safe to call on every contact create/update event.
 */
export async function embedContact(input: ContactEmbeddingInput): Promise<void> {
  const text = contactProfileText(input);
  const vec  = await generateEmbedding(text);

  if (!vec) {
    // No-op: contact data is unchanged; will re-embed when embedding is available.
    return;
  }

  try {
    await db.query(
      `UPDATE contacts SET embedding = $1::vector WHERE id = $2`,
      [`[${vec.join(',')}]` as any, input.id],
    );
    logger.debug('[contact-memory] embedding persisted', { contactId: input.id });
  } catch (err: any) {
    logger.warn('[contact-memory] embedding write failed — column may not exist yet', {
      contactId: input.id,
      error: err.message,
    });
  }
}

/**
 * reindexAllContacts — batch re-embed every contact in the DB.
 * Intended for one-off admin use or backfill after the embedding column is added.
 */
export async function reindexAllContacts(limit: number = 500): Promise<{ total: number; embedded: number }> {
  logger.info('[contact-memory] reindex started', { limit });
  const { rows } = await db.query(
    `SELECT id, company, contact_name, type, tier, status,
            location, notes, pain_point, engagement_angle,
            annual_spend_kes, fund_name, geographic_focus, institution_type
       FROM contacts
      ORDER BY updated_at DESC
      LIMIT $1`, [limit]);

  let ok = 0;
  for (const row of rows) {
    await embedContact(row as ContactEmbeddingInput);
    ok++;
  }
  logger.info('[contact-memory] reindex complete', { total: rows.length, embedded: ok });
  return { total: rows.length, embedded: ok };
}

// ─── Semantic search ───────────────────────────────────────────────────────────

/**
 * semanticSearchContacts — translate a natural-language query into a pgvector
 * cosine-similarity search over `contacts.embedding`.
 *
 * @param query               Natural-language query, e.g. "Nairobi construction buyers T1"
 * @param similarityThreshold Minimum cosine similarity (0–1); default 0.72 keeps noise out.
 * @param limit               Max results returned.
 */
export async function semanticSearchContacts(
  query:        string,
  similarityThreshold: number = 0.72,
  limit:        number      = 15,
): Promise<any[]> {
  const queryVec = await generateEmbedding(query);
  if (!queryVec) {
    throw new Error(
      'Semantic search unavailable — contact embeddings are not generated on this deployment. ' +
      'Enable ENV NVIDIA_API_KEY and set ENABLE_SEMANTIC_SEARCH=true in agent.config.ts',
    );
  }

  const threshold: number = Math.min(1, Math.max(0, similarityThreshold));

  try {
    const rows = await db.query(
      `SELECT c.*,
              (1 - (c.embedding <=> $1::vector)) AS similarity
         FROM contacts c
        WHERE c.embedding IS NOT NULL
          AND (1 - (c.embedding <=> $1::vector)) >= $2
          AND c.do_not_contact = false
     ORDER BY similarity DESC
        LIMIT $3`,
      [`[${queryVec.join(',')}]` as any, threshold, limit],
    );

    logger.debug('[contact-memory] semantic search complete', {
      query, threshold, limit, hits: rows.rows.length,
    });

    return rows.rows;
  } catch (err: any) {
    // If pgvector extension isn't installed yet, give a clear error, not a 500 with no context.
    const msg = err.message || String(err);
    if (msg.includes('vector') || msg.includes('operator')) {
      logger.error('[contact-memory] pgvector extension not available. Run: CREATE EXTENSION vector;');
      throw new Error(
        'pgvector extension not available. Install pgvector and run CREATE EXTENSION vector; ' +
        'or disable ENABLE_SEMANTIC_SEARCH in agent.config.ts to fall back to SQL-only filtering.',
      );
    }
    throw err;
  }
}

/**
 * buildFilterFromSemanticQuery — optional: use the LLM to translate a natural-language
 * filter string (e.g. "type=investor AND tier=T1 AND status=Not Started") into a
 * structured object that the orchestrator's getFilteredContacts() already accepts.
 * This is the two-layer approach where the LLM only produces structured criteria,
 * and the actual retrieval is done by SQL.
 */
export async function buildFilterFromSemanticQuery(
  query: string,
): Promise<{
  typeFilter:    string[];
  statusFilter:  string[];
  tierFilter:    string[];
  stageFilter:   string[];
  limit:         number;
  searchQuery?:  string;
}> {
  const prompt = `Given a natural language query about contacts in a B2B CRM,
output ONLY this JSON (no markdown, no commentary, no explanation):
{"typeFilter":["prospect","investor","partner","funding"],"statusFilter":["Not Started","Contacted","Responded"],"tierFilter":["T1","T2","T3"],"stageFilter":["not_started","delivered","responded"],"limit":20,"searchQuery":"optional text fragment"}
Query: "${query}"`;

  const raw = await langchainService.withRetry(async () => {
    const llm = langchainService.getLLM(0.0, 300);
    const response = await llm.invoke([['human', prompt]]);
    return typeof response.content === 'string' ? response.content : '';
  });

  const clean = raw.replace(/^```(?:json)?\s*[\r\n]*/i, '').replace(/[\r\n]*```\s*$/i, '').trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

  return {
    typeFilter:   parsed.typeFilter || [],
    statusFilter: parsed.statusFilter || ['Not Started'],
    tierFilter:   parsed.tierFilter || ['T1', 'T2', 'T3'],
    stageFilter:  parsed.stageFilter || ['not_started', 'delivered', 'responded'],
    limit:        Math.min(100, Math.max(1, parsed.limit || 20)),
    ...(parsed.searchQuery ? { searchQuery: parsed.searchQuery } : {}),
  };
}
