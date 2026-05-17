"""
Token-bucket rate limiter.

Design
──────
The  bucket starts with `burst` tokens.  Each `acquire()` call drains exactly
1 token.  Tokens are replenished at `rate` tokens/second.  When the bucket is
empty the caller blocks (via `asyncio.sleep(self.drain_time - dt)`) until the
next token arrives.

Why a token bucket?
──────────────────
A fixed-interval delay (e.g. `await asyncio.sleep(0.8)`) is easy to detect by
a naive WAF that records the inter-request gap.  A token bucket adds jitter and
lets bursts happen naturally — more human-like traffic patterns.
"""

from __future__ import annotations

import asyncio
import time
import threading
from dataclasses import dataclass, field


@dataclass
class TokenBucket:
    """
    Thread-safe / async-safe token bucket.

    Parameters
    ───────────
    rate:        tokens added per second  (the sustained average request rate)
    burst:       max tokens the bucket can hold (the burst capacity)
    """

    rate:       float = 4.0   # requests per second on average
    burst:      int   = 4      # max burst of 4 simultaneous requests
    _capacity:  float = field(init=False)  # mirrors `burst` once initialised
    _tokens:    float = field(init=False)
    _last_time: float = field(init=False)
    _lock:      threading.Lock = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._lock      = threading.Lock()
        self._capacity  = float(self.burst)
        self._tokens    = float(self.burst)
        self._last_time = time.monotonic()

    # ── Internal refill ─────────────────────────────────────────────────────────

    def _refill(self) -> None:
        now     = time.monotonic()
        elapsed = now - self._last_time
        self._tokens = min(
            self._capacity,
            self._tokens + elapsed * self.rate,
        )
        self._last_time = now

    # ── Synchronous acquire ─────────────────────────────────────────────────────

    def acquire(self) -> None:
        """Block (synchronously) until a token is available, then consume it."""
        while True:
            with self._lock:
                self._refill()
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return
                needed_tokens = 1.0 - self._tokens
                wait = needed_tokens / self.rate
            # Sleep outside the lock so other threads can refill concurrently
            time.sleep(wait)

    # ── Async acquire ───────────────────────────────────────────────────────────

    async def acquire_async(self) -> None:
        """Block (asynchronously) until a token is available, then consume it."""
        loop = asyncio.get_running_loop()
        while True:
            waited = False
            with self._lock:
                self._refill()
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return
                needed_tokens = 1.0 - self._tokens
                wait = needed_tokens / self.rate
                waited = wait > 0

            if waited:
                await asyncio.sleep(wait)

    # ── Non-blocking peek ───────────────────────────────────────────────────────

    def try_acquire(self) -> bool:
        """Consume a token if available; return True/False without blocking."""
        with self._lock:
            self._refill()
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return True
            return False

    # ── Stats ───────────────────────────────────────────────────────────────────

    @property
    def available(self) -> float:
        with self._lock:
            self._refill()
            return round(self._tokens, 4)

    @property
    def queue_delay(self) -> float:
        """Estimated seconds a new caller would wait before getting a token."""
        with self._lock:
            self._refill()
            if self._tokens >= 1.0:
                return 0.0
            needed = 1.0 - self._tokens
            return round(needed / self.rate, 4)
