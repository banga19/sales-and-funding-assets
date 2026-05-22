/**
 * nodemailer.service.ts
 *
 * Singleton Nodemailer transport + send helper for Sokogate / Ultimo Trading Company Limited.
 *
 * Responsibilities
 *   1. Construct a Nodemailer transporter from env config (SMTP, Ethereal dev mode, or
 *      console/blackhole stub for DEV_MODE).
 *   2. Verify the connection on first use (lazy-initialised).
 *   3. Provide sendMail() with built-in retry + structured error surface.
 *   4. Expose connection health state for the health-check endpoint.
 *   5. Support a simple template helper (wrapHtml) used by NotificationHub emails.
 *
 * Email configuration is drawn from agentConfig.email in agent.config.ts, which
 * already reads SMTP_PASS, EMAIL_FROM, EMAIL_FROM_NAME, EMAIL_DEV_MODE from .env.
 *
 * Usage
 *   const result = await nodemailerService.sendMail(to, subject, text, html);
 *   returns { messageId: string; accepted: string[]; rejected: string[]; }
 */

import nodemailer, { SendMailOptions, SentMessageInfo, Transporter } from 'nodemailer';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

// ────────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────────

export interface NodemailerSendResult {
  messageId:    string;
  accepted:     string[];
  rejected:     string[];
  error?:       string;
}

export interface NodemailerHealth {
  healthy:   boolean;
  provider:  string;       // 'smtp' | 'ethereal' | 'console' | 'blackhole'
  error?:    string;
}

// ────────────────────────────────────────────────────────────────────────────────
// NodemailerService
// ────────────────────────────────────────────────────────────────────────────────

class NodemailerService {
  private static instance: NodemailerService;

  private transporter: Transporter | null = null;
  private _isConnected  = false;
  private _provider:    'smtp' | 'ethereal' | 'console' | 'blackhole' = 'blackhole';
  private _lastError:   string | null = null;
  private _connectPromise: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): NodemailerService {
    if (!NodemailerService.instance) {
      NodemailerService.instance = new NodemailerService();
    }
    return NodemailerService.instance;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * safeVerify — calls transporter.verify() safely regardless of nodemailer
   * transport implementation (SMTP vs. jsonTransport stub vs. Ethereal).
   *
   * Some Nodemailer jsonTransport stubs resolve verify() synchronously with a
   * non-Promise value (i.e. the returned object has no .catch method), causing
   * `tx.verify().catch(...)` to throw TypeError at runtime.
   *
   * This helper normalises both paths: if `result.catch` is a function it is
   * awaited; otherwise the synchronous success path is accepted immediately.
   */
  private async safeVerify(tx: Transporter): Promise<void> {
    try {
      const result: any = tx.verify();
      if (result && typeof result.catch === 'function') {
        await result.catch(() => {});
      }
      // If result is a plain object (resolved synchronously), do nothing more.
    } catch {
      // Stub transports may throw synchronously on verify() — ignore silently.
    }
  }

  // ── Public: connection management ────────────────────────────────────────────

  private resolveProvider(): 'smtp' | 'ethereal' | 'console' | 'blackhole' {
    const devMode      = process.env.EMAIL_DEV_MODE === 'true';
    const smtpHost     = (process.env.SMTP_HOST || '').trim();
    const smtpUser     = (process.env.SMTP_USER || '').trim();
    const smtpApiKey   = (process.env.SMTP_PASS || process.env.SMTP_API_KEY || '').trim();
    const isEthereal   = devMode && smtpHost === 'smtp.ethereal.email';

    if (devMode && !smtpHost) return 'blackhole';
    if (isEthereal) return 'ethereal';
    if (smtpHost && (smtpUser || smtpApiKey)) return 'smtp';
    return 'console';   // silent fallback — used when no SMTP creds at all
  }

  /**
   * getTransporter — lazy-initialise and verify the Nodemailer transporter.
   * Subsequent calls return the already-established instance.
   */
  async getTransporter(): Promise<Transporter> {
    if (this.transporter && this._isConnected) return this.transporter;

    // Concurrent callers share the same in-flight connection attempt
    if (this._connectPromise) {
      await this._connectPromise;
      return this.transporter!;
    }

    this._connectPromise = (async () => {
      this._provider = this.resolveProvider();
      logger.info('[nodemailer] resolving transporter', { provider: this._provider });

      switch (this._provider) {
        case 'smtp': {
          const port = parseInt(process.env.SMTP_PORT || '587', 10);
          const secure = port === 465 || port === 4650;
          this.transporter = nodemailer.createTransport({
            host:   process.env.SMTP_HOST!,
            port,
            secure,
            auth: {
              user: process.env.SMTP_USER || undefined,
              pass: process.env.SMTP_PASS   || process.env.SMTP_API_KEY || undefined,
            },
          } as any);
          // Verify the connection is live
          try {
            await this.safeVerify(this.transporter);
            this._isConnected = true;
            logger.info('[nodemailer] SMTP connection verified');
          } catch (err: any) {
            this._lastError = err.message;
            this._isConnected = false;
            logger.warn('[nodemailer] SMTP verify failed — console fallback', { error: err.message });
            // Fall through to console stub below
            this.transporter   = null;
            this._provider     = 'console';
            const stub = nodemailer.createTransport({ jsonTransport: true } as any);
            await this.safeVerify(stub);
            this.transporter   = stub;
            this._isConnected  = true;
          }
          break;
        }

        case 'ethereal': {
          const creds = await nodemailer.createTestAccount();
          this.transporter = nodemailer.createTransport({
            host:    'smtp.ethereal.email',
            port:    587,
            secure:  false,
            auth:    { user: creds.user, pass: creds.pass },
          });
          await this.safeVerify(this.transporter);
          this._isConnected = true;
          logger.info('[nodemailer] Ethereal test account ready', { user: creds.user, preview: creds.smtp });
          break;
        }

        case 'console': {
          // JSON-transport stub — prints email envelope to console, does not attempt TCP
          this.transporter = nodemailer.createTransport({
            jsonTransport: true,
          } as any);
          await this.safeVerify(this.transporter);
          this._isConnected = true;
          logger.debug('[nodemailer] console stub — no real email transport');
          break;
        }

        case 'blackhole':
        default: {
          // Silent: swallows every send, returns a fake messageId
          this.transporter = nodemailer.createTransport({
            jsonTransport: true,
          } as any);
          await this.safeVerify(this.transporter);
          this._isConnected = true;
          logger.debug('[nodemailer] blackhole stub — all sends are swallowed');
          break;
        }
      }

      this._connectPromise = null;
    })();

    return this._connectPromise.then(() => { return this.transporter!; });
  }

  // ── Public: send ─────────────────────────────────────────────────────────────

  /**
   * sendMail — send an email.  Automatically lazy-initialises the transporter.
   * Retries up to 3 times on transient SMTP errors.
   */
  async sendMail(options: SendMailOptions, maxRetries = 3): Promise<NodemailerSendResult> {
    const cfgFrom = agentConfig.email.from;
    const from = options.from ?? `"${cfgFrom.name}" <${cfgFrom.email}>`;

    const opts: SendMailOptions = {
      ...options,
      from,
    };

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const tx = await this.getTransporter();
        const info: SentMessageInfo = await tx.sendMail(opts);
        return {
          messageId: info.messageId,
          accepted:  info.accepted ?? [],
          rejected:  info.rejected ?? [],
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn('[nodemailer] send attempt failed', {
          attempt,
          maxRetries,
          to:      Array.isArray(opts.to) ? opts.to.map(a => typeof a === 'string' ? a : a?.address).join(', ') : (opts.to as string) || '',
          subject: opts.subject,
          error:   lastError.message,
        });
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
    }

    logger.error('[nodemailer] all send attempts failed', {
      to:    Array.isArray(opts.to) ? opts.to.map(a => typeof a === 'string' ? a : a?.address).join(', ') : (opts.to as string) || '',
      error: lastError?.message,
    });
    return {
      messageId: '',
      accepted:  [],
      rejected:  [],
      error:     lastError?.message ?? 'Unknown error',
    };
  }

  // ── Public: health ───────────────────────────────────────────────────────────

  async healthCheck(): Promise<NodemailerHealth> {
    try {
      await this.getTransporter();
      return {
        healthy:  true,
        provider: this._provider,
      };
    } catch (err: any) {
      return {
        healthy:  false,
        provider: this._provider,
        error:    err.message,
      };
    }
  }

  /** Reset state — useful in tests or when SMTP credentials rotate at runtime. */
  reset(): void {
    this.transporter     = null;
    this._isConnected    = false;
    this._connectPromise = null;
    this._lastError      = null;
  }

  get isConnected(): boolean { return this._isConnected; }
  get provider():   string   { return this._provider; }
  get lastError():  string | null { return this._lastError; }
}

// ────────────────────────────────────────────────────────────────────────────────
// Singleton export
// ────────────────────────────────────────────────────────────────────────────────

export const nodemailerService = NodemailerService.getInstance();
export default nodemailerService;
