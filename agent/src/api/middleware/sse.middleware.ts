/**
 * sse.middleware.ts
 *
 * Server-Sent Events middleware for streaming agent progress to the frontend.
 * Provides a simple `sseStream` helper that sets up the correct headers and
 * returns a writable stream-like object.
 */

import { Request, Response, NextFunction } from 'express';

export interface SSEStream {
  sendEvent: (event: string, data: unknown) => void;
  sendComment: (comment: string) => void;
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
    res.flushHeaders?.();

    res.locals.sse = {
      sendEvent: (event: string, data: unknown) => {
        if (!res.writableEnded) {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      },
      sendComment: (comment: string) => {
        if (!res.writableEnded) {
          res.write(`: ${comment}\n\n`);
        }
      },
      close: () => {
        res.end();
      },
    } as SSEStream;

    // Keep-alive ping every 30s
    const ping = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      } else {
        clearInterval(ping);
      }
    }, 30_000);

    res.on('close', () => clearInterval(ping));
  } else {
    res.locals.sse = null;
  }
  next();
}

/**
 * Helper to send an SSE event directly on a response.
 */
export function sendSSE(res: Response, event: string, data: unknown): void {
  if (!res.writableEnded) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}
