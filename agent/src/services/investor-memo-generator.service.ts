import { ragService } from './rag.service';
import { InvestorProfile } from '../data/east-africa-investors';
import { logger } from '../utils/logger';

export interface InvestorMemoSection {
  title: string;
  content: string;
}

export interface InvestorMemo {
  fundName: string;
  investorProfile: InvestorProfile;
  sections: InvestorMemoSection[];
  generatedAt: string;
}

const COMPANY_CONTEXT =
  'Ultimo Trading Company Limited (sokogate.com) — Kenyan B2B construction-materials marketplace.\n' +
  'Raising: $500,000 pre-seed for 10% equity in Sokogate Kenya operations.\n' +
  'Metrics: 10,000+ customers, $600K+ ARR, 90%+ repeat rate.\n' +
  'Market: Kenya — $4B+ annual construction materials market, <5% online penetration.\n' +
  'Traction: Profitable unit economics, PMF in Nairobi, ready for 5-city expansion.\n' +
  'Revenue: Commission-based marketplace (8-15% take rate) + premium supplier listings.\n' +
  'Use of Funds: Logistics (40%), sales (30%), platform (20%), working capital (10%).';

const MEMO_SECTIONS = [
  'Executive Summary',
  'Company Overview',
  'Market Analysis',
  'Product & Technology',
  'Traction & Financials',
  'Competitive Landscape',
  'Use of Funds',
  'Risk Factors & Mitigation',
  'Investment Highlights',
  'Terms & Structure',
];

const MEMO_SYSTEM =
  'You are an investment analyst writing a confidential investor memorandum. ' +
  'Output ONLY the section content as plain text. No JSON, no markdown, no preamble.';

export class InvestorMemoGenerator {
  async generateMemo(investor: InvestorProfile, pitchSummary?: string): Promise<InvestorMemo> {
    const sections: InvestorMemoSection[] = [];

    for (const section of MEMO_SECTIONS) {
      try {
        const prompt =
          `Write the "${section}" section of a confidential investor memorandum for ${investor.fundName}.\n\n` +
          `COMPANY CONTEXT:\n${COMPANY_CONTEXT}\n\n` +
          `ABOUT THE INVESTOR:\n` +
          `Fund: ${investor.fundName}\n` +
          `Thesis: ${investor.thesis}\n` +
          `Why we fit: ${investor.preSeedFit}\n` +
          `Ticket range: ${investor.ticketRangeUsd}\n` +
          (pitchSummary ? `\nPITCH SUMMARY:\n${pitchSummary}\n` : '') +
          `\nWrite 3-5 detailed paragraphs for this section. Be specific, quantitative, and persuasive. ` +
          `Focus on what matters to ${investor.fundName} given their investment thesis. ` +
          `Output only the section content.`;

        const raw = await ragService.withRetry(() =>
          ragService.complete(
            [{ role: 'system', content: MEMO_SYSTEM }, { role: 'user', content: prompt }],
            { temperature: 0.3, maxTokens: 1024, stripThinking: true },
          ),
        );

        sections.push({ title: section, content: raw.trim() || '[Generation failed]' });
      } catch (err: any) {
        logger.warn('[memo] section generation failed', { section, error: err.message });
        sections.push({ title: section, content: '[Generation failed]' });
      }
    }

    return {
      fundName: investor.fundName,
      investorProfile: investor,
      sections,
      generatedAt: new Date().toISOString(),
    };
  }

  async generateSection(investor: InvestorProfile, sectionTitle: string, pitchSummary?: string): Promise<InvestorMemoSection | null> {
    const section = MEMO_SECTIONS.find(s => s.toLowerCase() === sectionTitle.toLowerCase());
    if (!section) return null;

    try {
      const prompt =
        `Write the "${section}" section of a confidential investor memorandum for ${investor.fundName}.\n\n` +
        `COMPANY CONTEXT:\n${COMPANY_CONTEXT}\n\n` +
        `ABOUT THE INVESTOR:\n` +
        `Fund: ${investor.fundName}\nThesis: ${investor.thesis}\nWhy we fit: ${investor.preSeedFit}\n` +
        (pitchSummary ? `\nPITCH SUMMARY:\n${pitchSummary}\n` : '') +
        `\nWrite 3-5 detailed paragraphs. Output only the section content.`;

      const raw = await ragService.withRetry(() =>
        ragService.complete(
          [{ role: 'system', content: MEMO_SYSTEM }, { role: 'user', content: prompt }],
          { temperature: 0.3, maxTokens: 1024, stripThinking: true },
        ),
      );

      return { title: section, content: raw.trim() || '[Generation failed]' };
    } catch (err: any) {
      logger.error('[memo] single section failed', { section, error: err.message });
      return null;
    }
  }
}

export const investorMemoGenerator = new InvestorMemoGenerator();
