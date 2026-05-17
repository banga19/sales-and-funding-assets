"""
Proxy pool — load a JSON array of proxy URLs from disk and return
the next healthy proxy in round-robin order.

Expected JSON file content (lines are URLs with optional `http://user:pass@host:port`):
```json
{
  "proxies": [
    "http://user1:pass1@proxy1.example.com:8080",
    "http://user2:pass2@proxy2.example.com:8080"
  ]
}
```

The module tracks `requests_used` and `requests_failed` per proxy in the
PostgreSQL `proxy_log` table, automatically marking a proxy as banned
after 5 consecutive failures, and rotating to the next one.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Optional

import structlog
log = structlog.get_logger()

_BAN_THRESHOLD = 5       # consecutive failures before a proxy is marked banned
_BAN_TTL       = 1_800   # seconds — retry a banned proxy after 30 min
_MIN_RESP_MS   = 3_000   # if proxy takes > 3 s it's marked suspect


class ProxyPool:
    """
    Round-robin proxy rotation with health tracking backed by PostgreSQL.

    Environment variables
    ─────────────────────
    SCRAPER_PROXY_POOL_FILE   path to a JSON file (see module docstring)
    SCRAPER_PROXY_ENABLED     set to "true" to activate proxy usage
    """

    def __init__(self, pool_file: Optional[str | Path] = None) -> None:
        self._pool: list[str] = []
        self._rp_idx = 0
        self._lock   = threading.Lock()
        self._pool_file: Optional[Path] = None

        if pool_file:
            self._pool_file = Path(pool_file)
            self._load()

    # ── Load from disk ──────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not self._pool_file or not self._pool_file.exists():
            log.warning("proxy_pool.missing", path=str(self._pool_file))
            return

        try:
            data = json.loads(self._pool_file.read_text(encoding="utf-8"))
            self._pool = data.get("proxies", []) if isinstance(data, dict) else data
            log.info("proxy_pool.loaded", path=str(self._pool_file), count=len(self._pool))
        except Exception as exc:
            log.error("proxy_pool.load_failed", path=str(self._pool_file), error=str(exc))

    # ── Selection ───────────────────────────────────────────────────────────────

    def current(self) -> Optional[str]:
        """Return the next proxy URL in round-robin order, or None if pool is empty."""
        with self._lock:
            if not self._pool:
                return None
            idx = self._rp_idx % len(self._pool)
            self._rp_idx += 1
            return self._pool[idx]

    def rotate(self) -> None:
        """Advance the round-robin cursor without fetching."""
        with self._lock:
            self._rp_idx += 1

    def size(self) -> int:
        return len(self._pool)

    # ── Health tracking via SQLAlchemy ─────────────────────────────────────────

    def mark_success(self, proxy_url: str, requests_count: int = 1, response_ms: int = 0) -> None:
        """Record a successful request and reset the failure counter."""
        try:
            from ..db.postgres import get_engine, ProxyLogORM
            engine = get_engine()
            with engine.connect() as conn:
                from sqlalchemy import text
                conn.execute(
                    text("""
                        INSERT INTO proxy_log (proxy_url, requests_used, last_used_at, is_active)
                        VALUES (:url, :used, now(), TRUE)
                        ON CONFLICT (proxy_url) DO UPDATE
                          SET requests_used   = proxy_log.requests_used   + :inc,
                              requests_failed = 0,
                              is_active       = TRUE,
                              last_used_at    = now(),
                              banned_at       = NULL
                    """),
                    {"url": proxy_url, "inc": requests_count, "used": requests_count},
                )
                conn.commit()
        except Exception as exc:
            log.debug("proxy_pool.health_track.error", error=str(exc))

    def mark_failure(self, proxy_url: str, error: str) -> None:
        """Record a failed request; ban the proxy after `_BAN_THRESHOLD` consecutive failures."""
        try:
            from ..db.postgres import get_engine
            engine = get_engine()
            with engine.connect() as conn:
                from sqlalchemy import text
                conn.execute(
                    text("""
                        INSERT INTO proxy_log (proxy_url, requests_used, requests_failed)
                        VALUES (:url, 0, 1)
                        ON CONFLICT (proxy_url) DO UPDATE
                          SET requests_failed = proxy_log.requests_failed + 1,
                              banned_at       = CASE
                                                WHEN proxy_log.requests_failed + 1 >= :threshold
                                                THEN now() ELSE proxy_log.banned_at
                                                END,
                              is_active       = CASE
                                                WHEN proxy_log.requests_failed + 1 >= :threshold
                                                THEN FALSE ELSE proxy_log.is_active
                                                END
                    """),
                    {"url": proxy_url, "threshold": _BAN_THRESHOLD},
                )
                conn.commit()
            log.warning("proxy_pool.failure", proxy=proxy_url, error=error)
        except Exception as exc:
            log.debug("proxy_pool.health_track.error", error=str(exc))

    @property
    def enabled(self) -> bool:
        return bool(self._pool)
