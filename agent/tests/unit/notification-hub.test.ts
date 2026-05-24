/**
 * unit/notification-hub.test.ts
 *
 * Unit tests for the notification hub pub/sub layer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/services/nodemailer.service', () => ({
  nodemailerService: {
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id', accepted: [], rejected: [] }),
  },
}));

vi.mock('../../src/config/agent.config', () => ({
  agentConfig: {
    escalation: { email: null },
    monitoring: { sentry: { environment: 'test' }, logLevel: 'warn' },
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { subscribe, unsubscribe, notify, notificationHub } from '../../src/services/notification-hub';
import type { NotificationEvent } from '../../src/services/notification-hub';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationHub', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe / unsubscribe', () => {
    it('registers a subscriber and returns an id', () => {
      const id = subscribe({
        label:     'test-sub',
        direction: 'INTERNAL',
        priority:  0,
        filter:    () => true,
        handler:   vi.fn(),
      });

      expect(typeof id).toBe('string');
      expect(id.startsWith('sub_')).toBe(true);

      unsubscribe(id);
    });

    it('unsubscribes successfully', () => {
      const id = subscribe({
        label:     'removable',
        direction: 'INTERNAL',
        priority:  0,
        filter:    () => true,
        handler:   vi.fn(),
      });

      const removed = unsubscribe(id);
      expect(removed).toBe(true);
    });

    it('returns false when unsubscribing unknown id', () => {
      expect(unsubscribe('nonexistent-id')).toBe(false);
    });
  });

  describe('notify()', () => {
    it('delivers event to matching subscriber', async () => {
      const handler = vi.fn();
      const id = subscribe({
        label:     'run-listener',
        direction: 'INTERNAL',
        priority:  0,
        filter:    (e) => e.type === 'runCompleted',
        handler,
      });

      const event: NotificationEvent = {
        type:      'runCompleted',
        agentName: 'bulk-sourcing',
        success:   true,
        durationMs: 1000,
      };

      notify(event);

      // Allow microtask queue to flush
      await new Promise(r => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledWith(event);
      unsubscribe(id);
    });

    it('does not deliver event to non-matching subscriber', async () => {
      const handler = vi.fn();
      const id = subscribe({
        label:     'funding-only',
        direction: 'INTERNAL',
        priority:  0,
        filter:    (e) => e.type === 'runFailed' && (e as any).agentName === 'funding-pitch',
        handler,
      });

      notify({ type: 'runCompleted', agentName: 'bulk-sourcing', success: true });

      await new Promise(r => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();
      unsubscribe(id);
    });

    it('delivers to multiple subscribers', async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();

      const id1 = subscribe({ label: 'h1', direction: 'INTERNAL', priority: 0, filter: () => true, handler: h1 });
      const id2 = subscribe({ label: 'h2', direction: 'INTERNAL', priority: 0, filter: () => true, handler: h2 });

      notify({ type: 'runStarted', agentName: 'content-creation' });

      await new Promise(r => setTimeout(r, 10));

      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();

      unsubscribe(id1);
      unsubscribe(id2);
    });

    it('does not throw when a subscriber handler throws', async () => {
      const id = subscribe({
        label:     'throwing-handler',
        direction: 'INTERNAL',
        priority:  0,
        filter:    () => true,
        handler:   () => { throw new Error('handler error'); },
      });

      // Should not propagate
      await expect(async () => {
        notify({ type: 'runCompleted', agentName: 'test', success: true });
        await new Promise(r => setTimeout(r, 10));
      }).not.toThrow();

      unsubscribe(id);
    });
  });

  describe('escalation deduplication', () => {
    it('deduplicates escalation events with same key', async () => {
      const handler = vi.fn();
      const id = subscribe({
        label:     'escalation-listener',
        direction: 'INTERNAL',
        priority:  0,
        filter:    (e) => e.type === 'escalation',
        handler,
      });

      const event: NotificationEvent = {
        type:      'escalation',
        agentName: 'funding-pitch',
        severity:  'error',
        reason:    'LLM timeout',
      };

      // Fire same event twice synchronously — should be deduplicated
      notify(event);
      notify(event);

      await new Promise(r => setTimeout(r, 20));

      // Handler should be called once (deduplication)
      expect(handler).toHaveBeenCalledTimes(1);
      unsubscribe(id);
    });
  });
});
