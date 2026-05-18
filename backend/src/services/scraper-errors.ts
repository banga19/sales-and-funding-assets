/**
 * Scraper error types — callers catch these individually so that the
 * HTTP route / BullMQ worker can respond with the correct status code
 * rather than always returning a generic 500.
 */

export class ScraperError extends Error {
  constructor(
    message:         string,
    public readonly code:            ScraperErrorCode,
    public readonly statusCode:      number,
    public readonly recoverable:     boolean,
    public readonly detail?:         Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ScraperError';
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, detail: this.detail };
  }
}

/** Stable codes for client-side handling. */
export type ScraperErrorCode =
  | 'ROBOTS_TXT_BLOCKED'       // 403  — URL disallowed by /robots.txt
  | 'RATE_LIMITED'             // 429  — Too many requests / could not acquire token
  | 'NETWORK_ERROR'            // 502  — DNS / connection / timeout / 5xx upstream
  | 'HTTP_CLIENT_ERROR'        // 4xx  — upstream responded with an unexpected 4xx
  | 'PARSE_ERROR'              // 422  — HTML was fetched but none of the selectors matched
  | 'CONCURRENT_JOB_EXISTS'    // 409  — Another scrape is already in-flight
  | 'INVALID_INPUT'            // 400  — Bad request body / query parameters
  | 'DB_ERROR'                 // 500  — Database write failed
  | 'UNKNOWN';                 // 500  — Everything else

export function robotsBlockedError(url: string): ScraperError {
  return new ScraperError(
    `URL blocked by /robots.txt — cannot scrape ${url}`,
    'ROBOTS_TXT_BLOCKED', 403, false, { url },
  );
}

export function rateLimitedError(reason: string): ScraperError {
  return new ScraperError(
    `Scraper rate-limited: ${reason}`,
    'RATE_LIMITED', 429, true, { reason },
  );
}

export function networkError(url: string, cause: unknown): ScraperError {
  return new ScraperError(
    `Network failure while requesting ${url}`,
    'NETWORK_ERROR', 502, true, { url, cause: String(cause) },
  );
}

export function parseError(url: string, detail?: Record<string, unknown>): ScraperError {
  return new ScraperError(
    `Failed to parse product data at ${url}`,
    'PARSE_ERROR', 422, false, { url, ...detail },
  );
}

export function dbError(operation: string, cause: unknown): ScraperError {
  return new ScraperError(
    `Database operation failed — ${operation}`,
    'DB_ERROR', 500, true, { operation, cause: String(cause) },
  );
}

export function concurrentJobError(jobId: string): ScraperError {
  return new ScraperError(
    `A scrape is already in progress — job ${jobId}`,
    'CONCURRENT_JOB_EXISTS', 409, true, { jobId },
  );
}

export function invalidInputError(message: string, detail?: Record<string, unknown>): ScraperError {
  return new ScraperError(
    `Invalid scrape request: ${message}`,
    'INVALID_INPUT', 400, false, detail,
  );
}

export const SCRAPER_ERROR_STATUS: Record<ScraperErrorCode, number> = {
  ROBOTS_TXT_BLOCKED:  403,
  RATE_LIMITED:        429,
  NETWORK_ERROR:       502,
  HTTP_CLIENT_ERROR:   400,
  PARSE_ERROR:         422,
  CONCURRENT_JOB_EXISTS: 409,
  INVALID_INPUT:       400,
  DB_ERROR:            500,
  UNKNOWN:             500,
};
