import { InvestorProfile, EAST_AFRICA_INVESTORS, PRESEED_TARGETS, InvestorType, InvestorTier } from '../data/east-africa-investors';

export interface ScoredInvestor extends InvestorProfile {
  score: number;
  breakdown: {
    ticketFit: number;
    geoFit: number;
    thesisFit: number;
    speedFit: number;
    statusBonus: number;
    tierBonus: number;
  };
}

const TICKET_TERMS = ['500K', '500', '250K', '200K', '100K', '50K', '25K'];

function scoreTicketFit(inv: InvestorProfile): number {
  const range = inv.ticketRangeUsd;
  const has500 = TICKET_TERMS.some(t => range.includes(t));
  if (!has500) return 2;
  if (range.includes('250K') || range.includes('200K')) return 10;
  if (range.includes('500K') && !range.includes('1M')) return 9;
  if (range.includes('500K') || range.includes('100K') || range.includes('50K') || range.includes('25K')) return 8;
  return 5;
}

function scoreGeoFit(inv: InvestorProfile): number {
  const geo = inv.geoFocus.toLowerCase();
  if (geo.includes('kenya')) {
    if (geo.includes('east africa') || geo.includes('uganda') || geo.includes('tanzania')) return 10;
    return 9;
  }
  if (geo.includes('east africa')) return 8;
  if (geo.includes('sub-saharan') || geo.includes('pan-africa') || geo.includes('africa')) return 6;
  if (geo.includes('global')) return 4;
  return 5;
}

const THESIS_KEYWORDS = ['b2b', 'construction', 'logistics', 'marketplace', 'supply chain', 'infrastructure', 'sme', 'enterprise', 'e-commerce', 'procurement', 'trade'];

function scoreThesisFit(inv: InvestorProfile): number {
  const thesis = (inv.thesis + ' ' + inv.preSeedFit).toLowerCase();
  let matches = 0;
  for (const kw of THESIS_KEYWORDS) {
    if (thesis.includes(kw)) matches++;
  }
  if (matches >= 4) return 10;
  if (matches === 3) return 8;
  if (matches >= 1) return 6;
  return 3;
}

function scoreSpeed(inv: InvestorProfile): number {
  const weeks = inv.decisionTimelineWeeks;
  const nums = weeks.split('-').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 12;
  if (avg <= 6) return 10;
  if (avg <= 10) return 8;
  if (avg <= 14) return 6;
  return 3;
}

function scoreStatus(inv: InvestorProfile): number {
  if (inv.contactStatus === 'not_started') return 10;
  return 3;
}

function scoreTier(inv: InvestorProfile): number {
  const map: Record<InvestorTier, number> = { T1: 10, T2: 8, T3: 6, T5: 7, T6: 5, T4: 2 };
  return map[inv.tier] ?? 5;
}

function scoreType(inv: InvestorProfile): number {
  const map: Record<InvestorType, number> = {
    vc: 10,
    corporate_vc: 8,
    impact_fund: 7,
    angel_network: 6,
    dfi: 3,
    angel: 5,
  };
  return map[inv.type] ?? 5;
}

export function scoreInvestor(inv: InvestorProfile): ScoredInvestor {
  const breakdown = {
    ticketFit: scoreTicketFit(inv),
    geoFit: scoreGeoFit(inv),
    thesisFit: scoreThesisFit(inv),
    speedFit: scoreSpeed(inv),
    statusBonus: scoreStatus(inv),
    tierBonus: scoreTier(inv),
  };
  const score = Math.round(
    breakdown.ticketFit * 0.25 +
    breakdown.geoFit * 0.20 +
    breakdown.thesisFit * 0.25 +
    breakdown.speedFit * 0.10 +
    breakdown.statusBonus * 0.10 +
    breakdown.tierBonus * 0.10,
  );
  return { ...inv, score, breakdown };
}

function rankLabel(score: number): string {
  if (score >= 9) return 'top';
  if (score >= 7) return 'strong';
  if (score >= 5) return 'moderate';
  return 'low';
}

export function getRankedInvestors(investors?: InvestorProfile[]): ScoredInvestor[] {
  const list = investors || PRESEED_TARGETS;
  return list.map(scoreInvestor).sort((a, b) => b.score - a.score);
}

export function getTopInvestors(n: number, investors?: InvestorProfile[]): ScoredInvestor[] {
  return getRankedInvestors(investors).slice(0, n);
}

export function getInvestorsByRank(rank: 'top' | 'strong' | 'moderate' | 'low', investors?: InvestorProfile[]): ScoredInvestor[] {
  return getRankedInvestors(investors).filter(i => rankLabel(i.score) === rank);
}

export function getCampaignSummary(): {
  total: number;
  ScoredInvestor: number;
  byRank: Record<string, number>;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const ranked = getRankedInvestors(EAST_AFRICA_INVESTORS);
  const byRank: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const i of ranked) {
    const r = rankLabel(i.score);
    byRank[r] = (byRank[r] || 0) + 1;
    byType[i.type] = (byType[i.type] || 0) + 1;
    byStatus[i.contactStatus] = (byStatus[i.contactStatus] || 0) + 1;
  }
  return {
    total: ranked.length,
    ScoredInvestor: ranked.filter(i => i.contactStatus === 'not_started').length,
    byRank,
    byType,
    byStatus,
  };
}
