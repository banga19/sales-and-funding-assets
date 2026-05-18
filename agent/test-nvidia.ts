import dotenv from 'dotenv';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

const client = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: process.env.NVIDIA_BASE_URL,
});

async function check() {
  try {
    const r = await client.chat.completions.create({
      model: process.env.NVIDIA_MODEL!,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    console.log('OK choices:', r.choices.length, r.choices[0]?.message?.content);
  } catch (e: any) {
    console.error('FAIL:', e.message, e.status);
  }
}

check();
