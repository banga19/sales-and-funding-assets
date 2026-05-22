import { parse } from 'papaparse';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

interface Prospect {
  id: string;
  prospect: string;
  company: string;
  tier: string;
  location: string;
  decisionMaker: string;
  email: string;
  phone: string;
  annualSpendKes: string;
  painPoint: string;
  engagementAngle: string;
  contactDate: string;
  status: string;
  callsMade: string;
  pilotDate: string;
  notes: string;
}

interface Investor {
  id: string;
  investor: string;
  fundName: string;
  tier: string;
  ticketSizeUsd: string;
  geographicFocus: string;
  investmentThesis: string;
  contactName: string;
  email: string;
  phone: string;
  decisionTimelineWeeks: string;
  firstContactDate: string;
  status: string;
  meetings: string;
  lastUpdate: string;
  termSheetDate: string;
  notes: string;
}

interface Partnership {
  id: string;
  prospect: string;
  company: string;
  tier: string;
  location: string;
  decisionMaker: string;
  email: string;
  phone: string;
  annualSpendKes: string;
  painPoint: string;
  engagementAngle: string;
  contactDate: string;
  status: string;
  callsMade: string;
  pilotDate: string;
  notes: string;
}

export class CSVProspectLoaderService {
  private static instance: CSVProspectLoaderService;
  private prospects: Prospect[] = [];
  private investors: Investor[] = [];
  private partnerships: Partnership[] = [];

  private constructor() {
    this.loadAllCSVs();
  }

  public static getInstance(): CSVProspectLoaderService {
    if (!CSVProspectLoaderService.instance) {
      CSVProspectLoaderService.instance = new CSVProspectLoaderService();
    }
    return CSVProspectLoaderService.instance;
  }

  private loadAllCSVs(): void {
    try {
      const projectRoot = '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets';
      const csvFiles = this.findCSVFiles(projectRoot);

      logger.info('[CSV-LOADER] Found CSV files', { count: csvFiles.length, files: csvFiles.map(f => f.split('/').pop()) });

      csvFiles.forEach(file => {
        try {
          let relativePath = file.replace(projectRoot, '');
          // Remove leading slash or backslash
          if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
            relativePath = relativePath.substring(1);
          }
          const data = readFileSync(file, 'utf8');

          if (relativePath.includes('TRACKER-PROSPECTS.csv')) {
            this.prospects = this.parseProspects(data);
            logger.info('[CSV-LOADER] Loaded prospects', { count: this.prospects.length, file: relativePath });
          } else if (relativePath.includes('TRACKER-INVESTORS.csv')) {
            this.investors = this.parseInvestors(data);
            logger.info('[CSV-LOADER] Loaded investors', { count: this.investors.length, file: relativePath });
          } else if (relativePath.includes('TRACKER-PARTNERSHIPS.csv')) {
            this.partnerships = this.parsePartnerships(data);
            logger.info('[CSV-LOADER] Loaded partnerships', { count: this.partnerships.length, file: relativePath });
          }
        } catch (error) {
          logger.warn('[CSV-LOADER] Failed to load CSV file', { file, error: error.message });
        }
      });
    } catch (error) {
      logger.error('[CSV-LOADER] Failed to load CSVs', { error: error.message });
    }
  }

  private findCSVFiles(dir: string): string[] {
    const files: string[] = [];
    const items = readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(dir, item.name);

      if (item.isDirectory() && !item.name.startsWith('.') && !item.name.includes('node_modules') && !item.name.includes('.kilo')) {
        files.push(...this.findCSVFiles(fullPath));
      } else if (item.isFile() && item.name.endsWith('.csv')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private parseProspects(csvData: string): Prospect[] {
    try {
      const result = parse<Prospect>(csvData, {
        header: true,
        skipEmptyLines: true
      });

      return result.data.filter(row => row.prospect && row.prospect.trim() !== '');
    } catch (error) {
      logger.error('[CSV-LOADER] Failed to parse prospects CSV', { error: error.message });
      return [];
    }
  }

  private parseInvestors(csvData: string): Investor[] {
    try {
      const result = parse<Investor>(csvData, {
        header: true,
        skipEmptyLines: true
      });

      return result.data.filter(row => row.investor && row.investor.trim() !== '');
    } catch (error) {
      logger.error('[CSV-LOADER] Failed to parse investors CSV', { error: error.message });
      return [];
    }
  }

  private parsePartnerships(csvData: string): Partnership[] {
    try {
      const result = parse<Partnership>(csvData, {
        header: true,
        skipEmptyLines: true
      });

      return result.data.filter(row => row.prospect && row.prospect.trim() !== '');
    } catch (error) {
      logger.error('[CSV-LOADER] Failed to parse partnerships CSV', { error: error.message });
      return [];
    }
  }

  public getProspects(): Prospect[] {
    return [...this.prospects];
  }

  public getInvestors(): Investor[] {
    return [...this.investors];
  }

  public getPartnerships(): Partnership[] {
    return [...this.partnerships];
  }

  public getProspectById(id: string): Prospect | undefined {
    return this.prospects.find(p => p.id === id);
  }

  public getInvestorById(id: string): Investor | undefined {
    return this.investors.find(i => i.id === id);
  }

  public getProspectsByStatus(status: string): Prospect[] {
    return this.prospects.filter(p => p.status.toLowerCase() === status.toLowerCase());
  }

  public getProspectsByTier(tier: string): Prospect[] {
    return this.prospects.filter(p => p.tier.toLowerCase() === tier.toLowerCase());
  }

  public reloadCSVs(): void {
    this.prospects = [];
    this.investors = [];
    this.partnerships = [];
    this.loadAllCSVs();
    logger.info('[CSV-LOADER] Reloaded all CSV files');
  }
}

export const csvProspectLoader = CSVProspectLoaderService.getInstance();
export default csvProspectLoader;