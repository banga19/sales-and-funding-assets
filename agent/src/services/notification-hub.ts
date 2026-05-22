/**
 * notification-hub.ts
 *
 * Event-driven notification hub for the Sokogate agent suite.
 *
 * The hub decouples notification delivery from agent execution. Every agent
 * fires a typed event (NotificationEvent) and the hub fans it out to zero or more
 * NotificationHandler subscriptions.
 *
 * Use-cases
 *  · Per-run email digests — after each master-switch cycle, emit a "runCycle"
 *    summary containing success/failure/counts per sub-agent; the hub routes
 *    it to nodemailer (internal team) and/or to external stakeholders.
 *  · Agent-to-agent handoff — an escalation event is received by
 *    followup.workflow.ts, content.agent.ts, orchestrator.ts without any
 *    direct coupling to the originating agent.
 *  · Admin alerts — for ENABLE_ESCALATION flag routes critical failures to the
 *    escalation address defined in agent.config.ts.
 *
 * Subscription types
 *  1. In-process callbacks  — registered via subscribe() for in-process consumers
 *  2. Nodemailer email      — registered via registerEmailHandler() for async delivery
 *  3. Webhook handler       — registered via registerWebhookHandler() for external dispatch
 *
 * Delivery modes (per-subscriber routing hint)
 *  TO_AGENT  — queue email for agent operator / ops team (default)
 *  TO_USER   — queue email to a specific contact customer / external recipient
 *  ESCALATE  — send via nodemailer + notify escalation contact
 *  INTERNAL  — fire only the in-process callback (no email/network hop)
 */

import { nodemailerService, type NodemailerSendResult } from './nodemailer.service';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

// ────────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────────

/** Direction hints — where the notification should be delivered. */
export type NotificationDirection = 'TO_AGENT' | 'TO_USER' | 'ESCALATE' | 'INTERNAL';

/** One subscription - identified by id so the caller can unsubscribe later. */
export type NotificationSubscriber = {
  id:             string;
  label:          string;
  direction:      NotificationDirection;
  priority:       number;   // 0 = fire-and-forget, 1 = sequential, 2 = priority queue
  filter:         (e: NotificationEvent) => boolean; // return true to handle
  handler:        (e: NotificationEvent) => Promise<void> | void;
  /** If set, destination email for nodemailer email notifications. */
  toEmail?:       string;
  /** Optional: only handle events for this agentName. */
  agentName?:     string;
};

/** Notification event subtypes.  All fields are always present. */
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface NotificationRunEvent {
  type:           'runCompleted' | 'runFailed' | 'runStarted';
  agentName:      string;
  runId?:         string;
  success?:       boolean;
  resultSummary?:  Record<string, any>;
  error?:          { message: string; detail?: string };
  durationMs?:     number;
}

export interface NotificationEscalationEvent {
  type:           'escalation';
  agentName:      string;
  severity:       NotificationSeverity;
  contactId?:     string;
  reason:         string;
  context?:       Record<string, any>;
}

export interface NotificationOutreachEvent {
  type:           'outreach' | 'followup' | 'reply' | 'delivered' | 'bounced';
  agentName:      string;
  contactId?:     string;
  contactEmail?:  string;
  subject?:       string;
  channel:        'email' | 'sms' | 'linkedin' | 'api';
  result?:        Record<string, any>;
}

export interface NotificationAgentAlertEvent {
  type:           'agentAlert';
  agentName:      string;
  severity:       NotificationSeverity;
  title:          string;
  detail:         string;
  action?:        { label: string; href: string };
}

export type NotificationEvent =
  | NotificationRunEvent
  | NotificationEscalationEvent
  | NotificationOutreachEvent
  | NotificationAgentAlertEvent;

/** Hub interface — methods available on the notification hub singleton. */
export interface NotificationHub {
  subscribe: (sub: Omit<NotificationSubscriber, 'id'>) => string;
  unsubscribe: (id: string) => boolean;
  notify: (event: NotificationEvent) => void;
  subscribers: ReadonlyArray<NotificationSubscriber>;
}

// ────────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────────

let subscriberIdSeq = 0;

function nextId(): string {
  return `sub_${++subscriberIdSeq}_${Date.now()}`;
}

function make(): { hub: NotificationHub; _notify: (e: NotificationEvent) => void } {
  const emailQueue: Array<{
    de:   NodemailerSendResult['rejected']['length'];
    item: { to: string; subject: string; html: string; text: string; direction: NotificationDirection };
  }> = [];

  const subscribers: NotificationSubscriber[] = [];

  // Inject escalation email address if configured
  const escalationEmail: string | null =
    (agentConfig.escalation?.email && !['null', 'none'].includes(agentConfig.escalation.email)) // easier API searches for nodemailer transactions by email; index back into agent.runs for detail.
      ? agentConfig.escalation.email
      : null;

  const hub = new class implements NotificationHub {
    private _queue: NotificationEvent[] = [];
    private _processing = false;

    get subscribers(): ReadonlyArray<NotificationSubscriber> { return subscribers; }

    subscribe(sub: Omit<NotificationSubscriber, 'id'>): string {
      const id = nextId();
      subscribers.push({ ...sub, id });
      return id;
    }

    unsubscribe(id: string): boolean {
      const idx = subscribers.findIndex(s => s.id === id);
      if (idx === -1) return false;
      subscribers.splice(idx, 1);
      return true;
    }

    /**
     * notify — add to queue and fire delivery on the next microtask.
     * Safe to call synchronously from agent code.
     */
    notify(event: NotificationEvent): void {
      this._queue.push(event);

      if (event.type === 'escalation' && event.agentName) {
        const seen = new Set<string>();
        const filtered: NotificationEvent[] = [];
        for (let i = this._queue.length - 1; i >= 0; i--) {
          const e = this._queue[i];
          const key = `${e.type}:${(e as any).agentName}:${(e as any).contactId ?? ''}`;
          if (!seen.has(key)) {
            seen.add(key);
            filtered.unshift(e);
          }
        }
        this._queue.length = 0;
        this._queue.push(...filtered);
      }

      if (!this._processing) {
        this._processing = true;
        queueMicrotask(() => this._flush());
      }
    }

    /**
     * notifyNow — deliver synchronously (skips queue). Use only from test setup or
     * before process exit.
     */
    async notifyNow(event: NotificationEvent): Promise<void> {
      await _event(event);
    }

    clear(): void {
      this._queue = [];
    }

    private async _flush(): Promise<void> {
      const batch = [...this._queue];
      this._queue.length = 0;
      this._processing = false;

      // Batch: deliver to all subscribers for every event in this tick.
      for (const event of batch) {
        await _event(event);
      }
    }
  };

  // ─── Private delivery function (defined out here so _flush can `await` it) ─────
  async function _event(event: NotificationEvent): Promise<void> {
    for (const sub of subscribers) {
      if (!sub.filter(event)) continue;
      try {
        await sub.handler(event);
      } catch (err: any) {
        logger.error('[notification-hub] subscriber handler failed', {
          subscriberId: sub.id,
          label:        sub.label,
          agentName:    (event as any).agentName,
          error:        err.message,
        });
      }
    }

    // Fire-and-forget nodemailer sends for email-typed subscribers
    await _maybeSendEmail(event);
  }

  async function _maybeSendEmail(event: NotificationEvent): Promise<void> {
    const emailSubs = subscribers.filter(
      s => s.direction === 'TO_AGENT' || s.direction === 'ESCALATE' || s.direction === 'TO_USER',
    );

    if (emailSubs.length === 0) return;

    await Promise.allSettled(emailSubs.map(async (sub) => {
      const to = sub.toEmail ?? escalationEmail ?? null;
      if (!to) { logger.warn('[notification-hub] no destination for email subscriber', { subscriberId: sub.id }); return; }

      const { subject, html, text } = _renderEmail(event, sub.direction);
      try {
        const result = await nodemailerService.sendMail({ to, subject, html, text });
        if (result.error) {
          logger.warn('[notification-hub] nodemailer send failed', {
            to, subject, error: result.error,
          });
        } else {
          logger.debug('[notification-hub] email delivered', { to, subject, direction: sub.direction });
        }
      } catch (err: any) {
        logger.error('[notification-hub] nodemailer error (outer)', {
          to, error: err.message,
        });
      }
    }));
  }

  function _renderEmail(event: NotificationEvent, direction: NotificationDirection): { subject: string; html: string; text: string } {
    const prefix = direction === 'ESCALATE'
      ? '[SOKOGATE ALERT] '
      : direction === 'TO_USER'
        ? '[Sokogate Update] '
        : '[Sokogate Agent Digest] ';

    const subject = prefix + _subject(event);
    const escapeHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    const agentName    = (event as any).agentName ?? 'agent';
    const typeLabel    = event.type;
    const detail       = _detailHtml(event);

    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:640px;margin:auto;padding:20px">
      <h2 style="margin:0 0 12px;color:#111;">${escapeHtml(prefix)}${escapeHtml(agentName)}</h2>
      <table cellpadding="6" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">
        <tr><td style="font-weight:bold;color:#555;width:140px">Event type</td>
            <td>${escapeHtml(typeLabel)}</td></tr>
        ${detail ? `<tr><td style="font-weight:bold;color:#555;vertical-align:top">Details</td><td>${detail}</td></tr>` : ''}
        ${(event as any).durationMs != null ? `<tr><td style="font-weight:bold;color:#555">Duration</td><td>${(event as any).durationMs} ms</td></tr>` : ''}
        ${(event as any).error     ? `<tr><td style="font-weight:bold;color:#c0392b;vertical-align:top">Error</td><td><code style="background:#fde8e8;padding:2px 6px;border-radius:3px;color:#c0392b">${escapeHtml((event as any).error.message)}</code></td></tr>` : ''}
      </table>
      <p style="color:#777;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:8px">
        Sent by the Sokogate Autonomous Agent Suite &mdash; ${new Date().toISOString()}
      </p>
    </div>`;

    const textLines = [
      `${prefix}${agentName} — ${typeLabel}`,
      `Time: ${new Date().toISOString()}`,
      (event as any).durationMs != null ? `Duration: ${(event as any).durationMs} ms` : null,
      (event as any).error ? `Error: ${(event as any).error.message}` : null,
      '',
    ].filter(Boolean);
    const text = textLines.join('\n');

    return { subject, html, text };
  }

  function _subject(e: NotificationEvent): string {
    const agent = (e as any).agentName ?? 'agent';
    switch (e.type) {
      case 'runStarted':   return `${agent} started`;
      case 'runCompleted': return `${agent} completed — success`;
      case 'runFailed':
        const msg = (e as any).error?.message ?? 'fail';
        return `${agent} failed: ${msg.slice(0, 60)}`;
      case 'escalation':   return `${agent} escalation: ` + (e as any).reason?.slice(0, 60);
      case 'outreach':     return `${agent} outreach to ${(e as any).contactEmail ?? 'unknown'}`;
      case 'followup':     return `${agent} follow-up sent`;
      case 'reply':        return `${agent} reply dispatched`;
      case 'delivered':    return `${agent} message delivered`;
      case 'bounced':      return `${agent} message bounced`;
      case 'agentAlert':   return `${agent} alert: ` + ((e as any).title || 'notification');
      default:             return `${agent}: ${(e as any).type}`;
    }
  }

  function _detailHtml(e: NotificationEvent): string {
    if (e.type === 'runCompleted' || e.type === 'runFailed') {
      const rs: Record<string, any> | undefined = (e as any).resultSummary;
      if (!rs) return '';
      const entries = Object.entries(rs).map(([k, v]) => `    <b>${k}:</b> ${JSON.stringify(v)}`).join('<br>');
      return entries || '';
    }
    if (e.type === 'escalation') {
      const i: any = e;
      return [
        i.context ? `context: ${JSON.stringify(i.context)}` : '',
        i.contactId ? `contactId: <code>${i.contactId}</code>` : '',
        i.severity ? `severity: <code>${i.severity}</code>` : '',
      ].filter(Boolean).join('<br>');
    }
    if (e.type === 'outreach' || e.type === 'reply' || e.type === 'followup') {
      const i: any = e;
      return [
        i.contactEmail ? `to: <code>${i.contactEmail}</code>` : '',
        i.subject ?    `subject: <em>${i.subject.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</em>` : '',
        i.result ?     `result: ${JSON.stringify(i.result)}` : '',
      ].filter(Boolean).join('<br>');
    }
    if (e.type === 'agentAlert') {
      const i: any = e;
      return [
        i.detail,
        i.action ? `Action: <a href="${i.action.href}">${i.action.label}</a>` : '',
      ].filter(Boolean).join('<br>');
    }
    return '';
  }

  return { hub, _notify: (e: NotificationEvent) => hub.notify(e) };
}

// ────────────────────────────────────────────────────────────────────────────────
// Singleton + public API
// ────────────────────────────────────────────────────────────────────────────────

/** The singleton hub instance. */
const { hub: notificationHub, _notify } = make();

/**
 * notify - fire a typed notification event.  Receives a structured
 * NotificationEvent and invokes all subscribed handlers asynchronously.
 *
 * Safe to call from any agent (synchronous fire-and-forget).
 *
 * @param event Structured notification event
 */
export function notify(event: NotificationEvent): void {
  _notify(event);
}

/**
 * subscribe - register an in-process callback handler. Returns the subscription
 * id for later unsubscribe.
 *
 * @param sub Subscriber settings
 * @returns subscription id
 */
export function subscribe(sub: Omit<NotificationSubscriber, 'id'>): string {
  return notificationHub.subscribe(sub);
}

/**
 * unsubscribe - remove a previously-registered subscriber.
 */
export function unsubscribe(id: string): boolean {
  return notificationHub.unsubscribe(id);
}

export { notificationHub };

// ────────────────────────────────────────────────────────────────────────────────
// Built-in subscribers (registered once at module load)
// ────────────────────────────────────────────────────────────────────────────────

/** Logger-only subscriber — fired for important lifecycle events only. */
const _logSub = notificationHub.subscribe({
  label:     'logger',
  direction: 'INTERNAL',
  priority:  0,
  filter:    (e) => ['runCompleted', 'runFailed', 'escalation', 'runStarted'].includes(e.type),
  handler:   (e) => { logger.debug('[hub] event', { type: e.type, agentName: (e as any).agentName }); },
});

/**
 * Email-on-failure subscriber — sends an email to agentConfig.escalation.email
 * whenever any sub-agent reports runFailed / escalation with severity 'error' or 'critical'.
 */
if (agentConfig.escalation?.email) {
  const sub = notificationHub.subscribe({
    label:      'nodemailer-failure-alerts',
    direction:  'ESCALATE',
    priority:   2,
    filter:     (e): e is (NotificationRunEvent | NotificationEscalationEvent) =>
      (e.type === 'runFailed' || e.type === 'escalation')
      && ['error', 'critical'].includes((e as any).severity ?? 'error'),
    handler:    (e) => { logger.warn('[hub:escalation]', { type: e.type }); },
  });
}

export { _logSub };
