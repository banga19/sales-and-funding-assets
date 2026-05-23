"""
User-Agent rotation pool — thread-safe round-robin from a JSON file.
Each concurrent worker picks the next UA in a cycling sequence so that
a single agent string isn't seen hitting the site with dozens of requests.
"""

from __future__ import annotations

import json
import random
import threading
from pathlib import Path
from typing import Optional

import structlog
log = structlog.get_logger()

_POOL_LOCK = threading.Lock()


class UserAgentPool:
    """
    Loads UA strings from `pool_path` (ships with a built-in fallback set).
    Supports three selection strategies:
      - round-robin (default): deterministically cycles through the pool
      - random:             picks uniformly at random on every call
      - once-per-crawl:      stick to one UA for the entire crawl run
    """

    _DEFAULT_POOL: list[str] = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.80",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    ]

    def __init__(self, pool_path: str | Path, strategy: str = "round-robin") -> None:
        self._pool: list[str] = []
        self._strategy = strategy
        self._rl_idx = 0          # round-robin cursor
        self._lock   = threading.Lock()
        self._last: Optional[str] = None  # used for 'once-per-crawl' strategy
        self._pool_path: str | Path = pool_path  # store for reload()
        self._load(pool_path)

    # ── Loading ─────────────────────────────────────────────────────────────────

    def _load(self, path: str | Path) -> None:
        pool_path = Path(path)
        try:
            if pool_path.exists():
                data = json.loads(pool_path.read_text(encoding="utf-8"))
                self._pool = data.get("user_agents", self._DEFAULT_POOL)
                log.info("user_agent_pool.loaded", path=str(pool_path), count=len(self._pool))
            else:
                log.warning("user_agent_pool.not_found", path=str(pool_path))
                self._pool = self._DEFAULT_POOL[:]
        except Exception as exc:
            log.error("user_agent_pool.load_failed", path=str(pool_path), error=str(exc))
            self._pool = self._DEFAULT_POOL[:]

        if not self._pool:
            log.warning("user_agent_pool.empty, falling back to defaults")
            self._pool = self._DEFAULT_POOL[:]

    # ── Selection ───────────────────────────────────────────────────────────────

    def get(self) -> str:
        with self._lock:
            if self._strategy == "random":
                return random.choice(self._pool)
            if self._strategy == "once-per-crawl" and self._last:
                return self._last
            # round-robin
            ua = self._pool[self._rl_idx % len(self._pool)]
            self._rl_idx += 1
            self._last = ua
            return ua

    # ── Inspect ─────────────────────────────────────────────────────────────────

    @property
    def count(self) -> int:
        return len(self._pool)

    def rotate(self) -> None:
        """Force the round-robin cursor to the next slot (without fetching)."""
        with self._lock:
            self._rl_idx += 1

    def reload(self) -> None:
        """Reload the pool from disk (useful when the file changes on disk)."""
        reload_path = self._pool_path if (self._pool_path) else "scraper/stealth/user_agents.json"
        self._load(reload_path)


UA_POOL_GLOBAL: Optional[UserAgentPool] = None  # lazy singleton, set on first use


def get_global_pool(path: str = "scraper/stealth/user_agents.json") -> UserAgentPool:
    global UA_POOL_GLOBAL
    if UA_POOL_GLOBAL is None:
        UA_POOL_GLOBAL = UserAgentPool(path)
    return UA_POOL_GLOBAL
