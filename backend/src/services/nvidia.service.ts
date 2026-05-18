import axios from 'axios';

const NVIDIA_API_KEY  = process.env.NVIDIA_API_KEY || '';
const NVIDIA_URL      = process.env.NVIDIA_API_URL || 'https://api.nvcf.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL    = process.env.NVIDIA_MODEL  || 'nvidia/llama-3.1-nemotron-70b-instruct';

function buildHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (NVIDIA_API_KEY) headers.Authorization = `Bearer ${NVIDIA_API_KEY}`;
  return headers;
}

export interface ResearchResult {
  background:   string;
  painPoints:   string[];
  tone:         string;
  communicationStyle: string;
}

export interface EmailDraft {
  subject: string;
  body:    string;
}

/**
 * deepResearch — ask NVIDIA to profile a persona and return structured research.
 * Falls back gracefully when no API key is configured.
 */
export async function deepResearch(persona: string): Promise<ResearchResult> {
  if (!NVIDIA_API_KEY) {
    return {
      background:   `General background for ${persona}.`,
      painPoints:   ['Budget constraints', 'Supplier reliability'],
      tone:         'professional',
      communicationStyle: 'direct',
    };
  }

  const prompt = `You are a B2B sales researcher. Research this persona in detail: "${persona}".
Provide their typical business background, recurring pain points, preferred communication tone, and communication style.
Return ONLY valid JSON with these fields:
{
  "background": "...",
  "painPoints": ["...", "..."],
  "tone": "...",
  "communicationStyle": "..."
}`;

  const { data } = await axios.post(
    NVIDIA_URL,
    {
      model: NVIDIA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000,
    },
    { headers: buildHeaders() },
  );

  const raw = data?.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(raw); } catch {
    return { background: raw, painPoints: [], tone: 'professional', communicationStyle: 'direct' };
  }
}


/**
 * aiCompletion — generic completion call; returns the raw assistant message text.
 * Falls back gracefully when no API key is configured.
 */
export async function aiCompletion(prompt: string): Promise<string> {
  if (!NVIDIA_API_KEY) {
    return '[aiCompletion] NVIDIA_API_KEY not configured — no AI response generated.';
  }

  const { data } = await axios.post(
    NVIDIA_URL,
    {
      model: NVIDIA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 1500,
    },
    { headers: buildHeaders() },
  );

  return data?.choices?.[0]?.message?.content ?? '';
}

export async function generateEmail(
  contactName: string,
  persona:      string,
  research:     ResearchResult,
): Promise<EmailDraft> {
  if (!NVIDIA_API_KEY) {
    return {
      subject: `Partnership opportunity for ${contactName}`,
      body: `Dear ${contactName},\n\nI hope this message finds you well. I am reaching out from Sokogate, an AI-powered B2B e-commerce platform.\n\nWe believe our solutions could bring significant value to your operations.\n\nWould you be open to a brief conversation this week?\n\nBest regards,\nSokogate Sales Team`,
    };
  }

  const summary = JSON.stringify(research);
  const prompt = `Using the following persona research: ${summary},
craft a highly personalised cold outreach email addressed to ${contactName} (${persona}).
The email should be context-aware, reference their pain points, have an appropriate tone, and include a clear call-to-action.
Return ONLY valid JSON with exactly these two fields: { "subject": "...", "body": "..." }`;

  const { data } = await axios.post(
    NVIDIA_URL,
    {
      model: NVIDIA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 800,
    },
    { headers: buildHeaders() },
  );

  const raw = data?.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(raw); } catch {
    return { subject: `Reaching out to ${contactName}`, body: raw };
  }
}
