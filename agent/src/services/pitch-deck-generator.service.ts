import { ragService } from './rag.service';
import { logger } from '../utils/logger';

export interface PitchSlide {
  slideNumber: number;
  title: string;
  subtitle: string;
  content: string;
  bulletPoints: string[];
  speakerNotes: string;
}

export interface PitchDeck {
  companyName: string;
  raiseAmount: string;
  equityPercent: string;
  slides: PitchSlide[];
  generatedAt: string;
}

export interface SlideConfig {
  title: string;
  subtitle: string;
}

const DECK_SLIDES: SlideConfig[] = [
  { title: 'Title Slide', subtitle: 'Company name, tagline, founder info' },
  { title: 'Problem', subtitle: 'The pain point in Kenya\'s construction supply chain' },
  { title: 'Solution', subtitle: 'How Sokogate digitizes construction materials procurement' },
  { title: 'Market Opportunity', subtitle: 'TAM, SAM, SOM for B2B construction e-commerce in Kenya' },
  { title: 'Product & Platform', subtitle: 'Platform overview, key features, screenshots' },
  { title: 'Traction & Metrics', subtitle: 'Key metrics: customers, ARR, repeat rate, unit economics' },
  { title: 'Business Model', subtitle: 'Revenue streams, margin structure, path to profitability' },
  { title: 'Competition', subtitle: 'Competitive landscape and moat' },
  { title: 'Growth Strategy', subtitle: 'Expansion plan: 5 cities, logistics network, supplier onboarding' },
  { title: 'Financial Projections', subtitle: '3-year forecast: revenue, costs, EBITDA' },
  { title: 'Use of Funds', subtitle: '$500K allocation breakdown' },
  { title: 'Team', subtitle: 'Founders, key hires, advisors' },
  { title: 'Investment Highlights', subtitle: 'Why invest now — key takeaways' },
];

const COMPANY_CONTEXT =
  'Ultimo Trading Company Limited (sokogate.com) — Kenyan B2B construction-materials marketplace.\n' +
  'Raising: $500,000 pre-seed for 10% equity in Sokogate Kenya operations.\n' +
  'Metrics: 10,000+ customers, $600K+ ARR, 90%+ repeat rate.\n' +
  'Use of Funds: Expand logistics network (40%), grow sales team (30%), platform development (20%), working capital (10%).\n' +
  'Market: Kenya — $4B+ annual construction materials market, highly fragmented, <5% online penetration.\n' +
  'Traction: Profitable unit economics, proven product-market fit in Nairobi, ready to scale to 5 more Kenyan cities.\n' +
  'Revenue Model: Commission-based marketplace (8-15% take rate) + premium supplier listings.\n' +
  'Competition: Traditional informal brokers, Jumba (similar model, raised ~$1M), hardware stores.\n' +
  'Team: Founded by experienced Kenya-based entrepreneurs with construction and e-commerce background.';

const DECK_SYSTEM =
  'You are a pitch deck consultant helping a startup prepare for investor meetings. ' +
  'Output ONLY valid JSON. No thinking, no explanation, no markdown.';

const BATCH_SIZE = 3;

export class PitchDeckGenerator {
  async generateDeck(fundName?: string): Promise<PitchDeck> {
    const slides: PitchSlide[] = new Array(DECK_SLIDES.length);

    for (let start = 0; start < DECK_SLIDES.length; start += BATCH_SIZE) {
      const batch = DECK_SLIDES.slice(start, start + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((cfg, i) => {
          const slideNum = start + i + 1;
          return this._generateOne(slideNum, cfg, fundName);
        }),
      );
      for (let j = 0; j < results.length; j++) {
        slides[start + j] = results[j];
      }
    }

    const failed = slides.filter(s => s.content === '[Generation failed]');
    if (failed.length > 0) {
      logger.info('[pitch-deck] retrying failed slides', { count: failed.length });
      const retries = await Promise.all(
        failed.map(s => this._generateOne(s.slideNumber, DECK_SLIDES[s.slideNumber - 1], fundName)),
      );
      for (const r of retries) {
        slides[r.slideNumber - 1] = r;
      }
    }

    return {
      companyName: 'Ultimo Trading Company Limited (Sokogate)',
      raiseAmount: '$500,000',
      equityPercent: '10%',
      slides,
      generatedAt: new Date().toISOString(),
    };
  }

  async generateSlide(slideNumber: number, fundName?: string): Promise<PitchSlide | null> {
    const idx = slideNumber - 1;
    if (idx < 0 || idx >= DECK_SLIDES.length) return null;
    const cfg = DECK_SLIDES[idx];
    try {
      return await this._generateOne(slideNumber, cfg, fundName);
    } catch (err: any) {
      logger.error('[pitch-deck] single slide generation failed', { slide: cfg.title, error: err.message });
      return null;
    }
  }

  private async _generateOne(slideNumber: number, cfg: SlideConfig, fundName?: string): Promise<PitchSlide> {
    const fundContext = fundName ? `\nThis pitch is tailored for ${fundName}.` : '';
    try {
      const prompt =
        `Generate content for slide ${slideNumber}: "${cfg.title}" — ${cfg.subtitle}\n\n` +
        `COMPANY CONTEXT:\n${COMPANY_CONTEXT}${fundContext}\n\n` +
        `Return ONLY valid JSON with this structure:\n` +
        `{\n` +
        `  "content": "2-3 sentence narrative for this slide",\n` +
        `  "bulletPoints": ["point 1", "point 2", "point 3", "point 4"],\n` +
        `  "speakerNotes": "What the founder should say during this slide (2-3 sentences)"\n` +
        `}\n\n` +
        `Make bullet points specific, quantitative, and compelling for investors.`;

      const raw = await ragService.withRetry(() =>
        ragService.complete(
          [{ role: 'system', content: DECK_SYSTEM }, { role: 'user', content: prompt }],
          { temperature: 0.4, maxTokens: 1024, stripThinking: true },
        ),
      );

      const parsed = this.parseSlideJson(raw);
      return {
        slideNumber,
        title: cfg.title,
        subtitle: cfg.subtitle,
        content: parsed?.content || '',
        bulletPoints: parsed?.bulletPoints || [],
        speakerNotes: parsed?.speakerNotes || '',
      };
    } catch (err: any) {
      logger.warn('[pitch-deck] slide generation failed', { slide: cfg.title, error: err.message });
      return {
        slideNumber,
        title: cfg.title,
        subtitle: cfg.subtitle,
        content: '[Generation failed]',
        bulletPoints: [],
        speakerNotes: '',
      };
    }
  }

  private parseSlideJson(raw: string): { content: string; bulletPoints: string[]; speakerNotes: string } | null {
    const clean = raw
      .replace(/^```(?:json)?\s*[\r\n]*/i, '')
      .replace(/[\r\n]*```\s*$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(clean);
      if (parsed && typeof parsed.content === 'string') {
        return {
          content: parsed.content || '',
          bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints : [],
          speakerNotes: parsed.speakerNotes || '',
        };
      }
    } catch {
      const contentMatch = clean.match(/"content"\s*:\s*"([^"]+)"/);
      const bulletsMatch = clean.match(/"bulletPoints"\s*:\s*(\[[\s\S]*?\])/);
      const notesMatch = clean.match(/"speakerNotes"\s*:\s*"([^"]+)"/);
      if (contentMatch) {
        return {
          content: contentMatch[1] || '',
          bulletPoints: bulletsMatch ? this.parseBulletArray(bulletsMatch[1]) : [],
          speakerNotes: notesMatch?.[1] || '',
        };
      }
    }
    return null;
  }

  private parseBulletArray(str: string): string[] {
    try { return JSON.parse(str); } catch { return []; }
  }
}

export const pitchDeckGenerator = new PitchDeckGenerator();
