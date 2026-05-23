"""
config.py — project-level environment defaults and DB DSN helpers.

Reads from environment variables first; falls back to safe local-dev defaults.
Other modules should import from here only when they cannot use
`sokogate_scraper.config.settings` (pydantic-based).
"""

import os
from urllib.parse import urlparse

# ── Redis ────────────────────────────────────────────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/1")

# ── PostgreSQL ──────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://app:app@localhost:5432/sales_assets",
)

# Robust psycopg2 DSN derived from DATABASE_URL
db_parsed = urlparse(DATABASE_URL)
DB_DSN = (
    f"dbname={db_parsed.path[1:]} user={db_parsed.username} "
    f"password={db_parsed.password} host={db_parsed.hostname} port={db_parsed.port}"
)
