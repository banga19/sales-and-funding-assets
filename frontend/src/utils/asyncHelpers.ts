/**
 * Shared async helpers used by OutreachContext, outreachApi,
 * AgentControlPanel, and EffectLayer.
 */

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS  = 10_000;

/** Simple delay helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempt `fn` up to `maxAttempts` times, sleeping (RETRY_BASE_MS * 2^attempt)
 * between tries (capped at RETRY_MAX_MS).
 *
 * Wraps each attempt in a `Promise.race` against an AbortSignal.timeout
 * derived from the caller-supplied `requestTimeoutMs`.
 */
export async function retryWithBackoff<T>(
  fn:                      () => Promise<T>,
  maxAttempts:             number          = 3,
  onAttempt?:              (attempt: number, error: unknown) => void,
  requestTimeoutMs?:       number,
): Promise<T> {
  const timeoutMs = requestTimeoutMs ?? 30_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return result;
    } catch (err) {
      lastErr = err;
      onAttempt?.(attempt + 1, err);
      if (attempt < maxAttempts - 1) {
        await sleep(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
      }
    }
  }
  throw lastErr;
}

/**
 * Race a single potential-async value against a deadline. Returns the resolved
 * value if the fn finishes first, or throws the timeout error.
 */
export function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms),
    ),
  ]);
}
