/**
 * Agent NVIDIA Adapter
 *
 * Thin wrapper that mirrors the AI completion pattern used in
 * backend/src/services/nvidia.service.ts but lives inside the agent
 * workspace so that TypeScript can resolve the module without crossing
 * workspace boundaries.
 */

import axios from 'axios';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const NVIDIA_URL = process.env.NVIDIA_API_URL || 'https://api.nvcf.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct';

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (NVIDIA_API_KEY) headers.Authorization = `Bearer ${NVIDIA_API_KEY}`;
  return headers;
}

/**
 * aiCompletion — generic completion call; returns the raw assistant message text.
 * Falls back gracefully when no API key is configured.
 */
export async function aiCompletion(prompt: string, maxTokens: number = 1500): Promise<string> {
  if (!NVIDIA_API_KEY) {
    return '[aiCompletion] NVIDIA_API_KEY not configured — no AI response generated.';
  }

  const { data } = await axios.post(
    NVIDIA_URL,
    {
      model: NVIDIA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: maxTokens,
    },
    { headers: buildHeaders() },
  );

  return data?.choices?.[0]?.message?.content ?? '';
}

// Made with Bob
