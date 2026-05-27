import { db } from '../database/db.client';
import { logger } from '../utils/logger';

export type PipelineStage =
  | 'proposed' | 'emailed' | 'opened' | 'replied'
  | 'meeting_scheduled' | 'meeting_done' | 'term_sheet'
  | 'closed_won' | 'closed_lost';

export type PipelineAction =
  | 'pitch_generated' | 'email_sent' | 'email_opened' | 'email_replied'
  | 'followup_sent' | 'meeting_booked' | 'meeting_completed'
  | 'term_sheet_sent' | 'deal_closed' | 'deal_lost' | 'stage_change' | 'note_added';

export interface PipelineLogEntry {
  id: string;
  prospectId: string;
  fundName: string;
  stage: PipelineStage;
  action: PipelineAction;
  detail: Record<string, any>;
  createdAt: string;
}

export interface PipelineDashboard {
  totalProspects: number;
  byStage: Record<PipelineStage, number>;
  recentActivity: PipelineLogEntry[];
  contactedToday: number;
  meetingsThisWeek: number;
}

export class InvestorPipelineService {
  async logInteraction(
    prospectId: string,
    fundName: string,
    stage: PipelineStage,
    action: PipelineAction,
    detail: Record<string, any> = {},
  ): Promise<string> {
    const id = `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await db.query(
        `INSERT INTO investor_outreach_log (id, prospect_id, fund_name, stage, action, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, prospectId, fundName, stage, action, JSON.stringify(detail)],
      );
      await db.query(
        `UPDATE investor_prospects
            SET status = $1, last_contacted_at = NOW()
          WHERE id = $2`,
        [stage, prospectId],
      );
      return id;
    } catch (err: any) {
      logger.error('[pipeline] logInteraction failed', { prospectId, error: err.message });
      return '';
    }
  }

  async updateStatus(prospectId: string, status: PipelineStage, notes?: string): Promise<boolean> {
    try {
      if (notes) {
        await db.query(
          `UPDATE investor_prospects
              SET status = $1, notes = COALESCE(notes || E'\n' || $2, $2), last_contacted_at = NOW()
            WHERE id = $3`,
          [status, notes, prospectId],
        );
      } else {
        await db.query(
          `UPDATE investor_prospects
              SET status = $1, last_contacted_at = NOW()
            WHERE id = $2`,
          [status, prospectId],
        );
      }
      await this.logInteraction(prospectId, '', status, 'stage_change', { newStatus: status, notes });
      return true;
    } catch (err: any) {
      logger.error('[pipeline] updateStatus failed', { prospectId, error: err.message });
      return false;
    }
  }

  async getProspectLog(prospectId: string): Promise<PipelineLogEntry[]> {
    try {
      const { rows } = await db.query(
        `SELECT id, prospect_id, fund_name, stage, action, detail, created_at
           FROM investor_outreach_log
          WHERE prospect_id = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [prospectId],
      );
      return rows.map((r: any) => ({
        id: r.id,
        prospectId: r.prospect_id,
        fundName: r.fund_name,
        stage: r.stage,
        action: r.action,
        detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail,
        createdAt: r.created_at,
      }));
    } catch (err: any) {
      logger.error('[pipeline] getProspectLog failed', { prospectId, error: err.message });
      return [];
    }
  }

  async getDashboard(): Promise<PipelineDashboard> {
    try {
      const { rows: stageRows } = await db.query(
        `SELECT status, COUNT(*)::int AS count
           FROM investor_prospects
          WHERE investor_profile = 'angel'
          GROUP BY status`,
      );
      const byStage = {
        proposed: 0, emailed: 0, opened: 0, replied: 0,
        meeting_scheduled: 0, meeting_done: 0, term_sheet: 0,
        closed_won: 0, closed_lost: 0,
      } as Record<PipelineStage, number>;
      for (const r of stageRows) {
        if (r.status in byStage) byStage[r.status as PipelineStage] = r.count;
      }

      const { rows: logRows } = await db.query(
        `SELECT id, prospect_id, fund_name, stage, action, detail, created_at
           FROM investor_outreach_log
          ORDER BY created_at DESC
          LIMIT 20`,
      );
      const recentActivity: PipelineLogEntry[] = logRows.map((r: any) => ({
        id: r.id,
        prospectId: r.prospect_id,
        fundName: r.fund_name,
        stage: r.stage,
        action: r.action,
        detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail,
        createdAt: r.created_at,
      }));

      const { rows: todayRows } = await db.query(
        `SELECT COUNT(*)::int AS count
           FROM investor_outreach_log
          WHERE action = 'email_sent'
            AND created_at >= CURRENT_DATE`,
      );

      const { rows: meetingRows } = await db.query(
        `SELECT COUNT(*)::int AS count
           FROM investor_outreach_log
          WHERE action = 'meeting_booked'
            AND created_at >= DATE_TRUNC('week', NOW())`,
      );

      const { rows: totalRows } = await db.query(
        `SELECT COUNT(*)::int AS count
           FROM investor_prospects
          WHERE investor_profile = 'angel'`,
      );

      return {
        totalProspects: totalRows[0]?.count || 0,
        byStage,
        recentActivity,
        contactedToday: todayRows[0]?.count || 0,
        meetingsThisWeek: meetingRows[0]?.count || 0,
      };
    } catch (err: any) {
      logger.error('[pipeline] getDashboard failed', { error: err.message });
      return {
        totalProspects: 0, byStage: {} as Record<PipelineStage, number>,
        recentActivity: [], contactedToday: 0, meetingsThisWeek: 0,
      };
    }
  }

  async addNote(prospectId: string, note: string): Promise<boolean> {
    try {
      await db.query(
        `UPDATE investor_prospects
            SET notes = COALESCE(notes || E'\n' || $1, $1)
          WHERE id = $2`,
        [note, prospectId],
      );
      await this.logInteraction(prospectId, '', 'proposed', 'note_added', { note });
      return true;
    } catch (err: any) {
      logger.error('[pipeline] addNote failed', { prospectId, error: err.message });
      return false;
    }
  }

  async getProspectsByStage(stage: PipelineStage): Promise<any[]> {
    try {
      const { rows } = await db.query(
        `SELECT id, contact_name, contact_email, firm, fit_reason, pitch_summary,
                status, last_contacted_at, notes, created_at
           FROM investor_prospects
          WHERE investor_profile = 'angel' AND status = $1
          ORDER BY last_contacted_at DESC NULLS LAST, created_at DESC`,
        [stage],
      );
      return rows;
    } catch (err: any) {
      logger.error('[pipeline] getProspectsByStage failed', { stage, error: err.message });
      return [];
    }
  }
}

export const investorPipeline = new InvestorPipelineService();
