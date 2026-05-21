/**
 * sse.middleware.ts
 *
 * Server-Sent Events middleware for streaming agent progress to the frontend.
 * Provides a simple `sseStream` helper that sets up the correct headers and
 * returns a writable stream-like object.
 */

import { Request, Response, NextFunction } from 'express';

export interface SSEStream {
  sendEvent:   (event: string, data: unknown) => void;
  sendComment: (comment: string) => void;
  sendError:   (message: string, code?: string) => void;
  close: () => void;
}

/**
 * SSE middleware — intercepts requests with `Accept: text/event-stream`
 * and provides an SSE stream via `res.locals.sse`.
 */
export function sseMiddleware(req: Request, res: Response, next: NextFunction): void {
  const accept = req.headers.accept || '';
  if (accept.includes('text/event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Retry', '3000');
    res.flushHeaders?.();

    let closed = false;

    res.locals.sse = {
      sendEvent: (event: string, data: unknown) => {
        if (!res.writableEnded && !closed) {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      },
      sendComment: (comment: string) => {
        if (!res.writableEnded && !closed) {
          res.write(`: ${comment}\n\n`);
        }
      },
      sendError: (message: string, code?: string) => {
        if (!res.writableEnded && !closed) {
          res.write(`event: error\n`);
          res.write(`data: ${JSON.stringify({ message, code, ts: new Date().toISOString() })}\n\n`);
        }
      },
      close: () => {
        closed = true;
        res.end();
      },
    } as SSEStream;

    // Keep-alive heartbeat every 30 s
    const ping = setInterval(() => {
      if (!res.writableEnded && !closed) {
        res.write(': heartbeat\n\n');
      } else {
        clearInterval(ping);
      }
    }, 30_000);

    res.on('close',  () => { closed = true; clearInterval(ping); });
    res.on('finish', () => { closed = true; clearInterval(ping); });
  } else {
    res.locals.sse = null;
  }
  next();
}

/**
 * Helper to send an SSE event directly on a response.
 * Also used inside agent-loop routes when `sse` locals are unavailable.
 */
export function sendSSE(res: Response, event: string, data: unknown): void {
  if (!res.writableEnded) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}
