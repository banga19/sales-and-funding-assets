"""
`settings` — typed access to all environment variables consumed by the scraper stack.
Loaded from `.env` via `python-dotenv` + `pydantic-settings`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _load_env_file() -> dict[str, str]:
    """Load a `.env` file from the repo root (one level above this file's package)."""
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if env_path.exists():
        env: dict[str, str] = {}
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"')
        return env
    return {}


class ScraperConfig(BaseSettings):
    """Environment variable schema for the scraper subsystem."""
    model_config = SettingsConfigDict(
        env_file    = Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding = "utf-8",
        extra       = "ignore",
    )

    # ── Target site ─────────────────────────────────────────────────────────────
    sokogate_base_url:    str      = Field(default="https://sokogate.com")
    sokogate_listing_path: str     = Field(default="/product-category")
    sokogate_product_path: str    = Field(default="/product")

    # ── Scraping limits ─────────────────────────────────────────────────────────
    scraper_max_concurrency: int  = Field(default=4, ge=1, le=64)
    scraper_max_pages_per_run: int = Field(default=10, ge=1, le=100)
    scraper_max_products_per_run: int = Field(default=50, ge=1, le=1000)
    scraper_request_delay_ms: int = Field(default=800, ge=0, le=60_000)
    scraper_timeout_seconds: int  = Field(default=25, ge=1)
    scraper_retry_attempts: int  = Field(default=3, ge=0, le=10)
    scraper_retry_backoff_base: float = Field(default=2.0, ge=0.5)
    scraper_user_agent_pool_file: str = Field(default="scraper/stealth/user_agents.json")
    scraper_proxy_pool_file: str   = Field(default="")
    scraper_proxy_enabled: bool    = Field(default=False)
    scraper_proxy_rotation_after: int = Field(default=50, ge=1)
    scraper_use_playwright: bool   = Field(default=False)
    scraper_playwright_headless: bool = Field(default=True)
    scraper_disable_web_security: bool = Field(default=False)
    scraper_verify_ssl:       bool = Field(default=False, description="Set True to enforce HTTPS cert verification; set False to bypass for sites with self-signed certs")
    scraper_cookies_file: str     = Field(default="scraper/stealth/cookies.json")

    # ── Database ────────────────────────────────────────────────────────────────
    postgres_host:     str = Field(default="localhost")
    postgres_port:     int = Field(default=5432, ge=1, le=65535)
    postgres_user:     str = Field(default="sokogate")
    postgres_password: str = Field(default="sokogate-dev-change-me")
    postgres_db:       str = Field(default="sokogate")
    postgres_pool_size: int = Field(default=10, ge=1, le=100)
    postgres_max_overflow: int = Field(default=20, ge=0)

    # ── Redis ──────────────────────────────────────────────────────────────────
    redis_url: str = Field(default="redis://:sokogate-redis-dev@localhost:6379/0")

    # ── Celery ─────────────────────────────────────────────────────────────────
    celery_broker_url:        str = Field(default="redis://:sokogate-redis-dev@localhost:6379/0")
    celery_result_backend:    str = Field(default="redis://:sokogate-redis-dev@localhost:6379/1")
    celery_beat_enabled:      bool = Field(default=True)
    celery_full_scrape_minute: int      = Field(default=0)
    celery_full_scrape_hour:   int      = Field(default=2)

    @property
    def celery(self) -> dict:
        return {
            'broker_url': self.celery_broker_url,
            'result_backend': self.celery_result_backend,
            'beat_enabled': self.celery_beat_enabled,
            'full_scrape_minute': self.celery_full_scrape_minute,
            'full_scrape_hour': self.celery_full_scrape_hour,
        }

    # ── FastAPI ────────────────────────────────────────────────────────────────
    fastapi_port:       int = Field(default=8000, ge=1, le=65535)
    fastapi_reload:     bool = Field(default=False)
    fastapi_cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:3001,http://localhost:8000"
    )

    version: str = Field(default="2.0.0")
    environment: str = Field(default="development")

    # ── Convenience properties ──────────────────────────────────────────────────

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def database_url_sync(self) -> str:
        """URL with sync driver (for engine creation outside async context)."""
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def fastapi_cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.fastapi_cors_origins.split(",") if o.strip()]

    @property
    def proxy_pool_file(self) -> Optional[Path]:
        p = Path(self.scraper_proxy_pool_file)
        return p if p.exists() and p.is_file() else None

    @property
    def user_agent_pool_file(self) -> Path:
        return Path(self.scraper_user_agent_pool_file)

    @property
    def fastapi(self) -> dict:
        from fastapi import FastAPI
        return {
            'port': self.fastapi_port,
            'reload': self.fastapi_reload,
            'cors_origins': self.fastapi_cors_origins,
        }

    @property
    def scraper(self) -> dict:
        return {
            'max_concurrency': self.scraper_max_concurrency,
            'max_pages_per_run': self.scraper_max_pages_per_run,
            'max_products_per_run': self.scraper_max_products_per_run,
            'request_delay_ms': self.scraper_request_delay_ms,
            'timeout_seconds': self.scraper_timeout_seconds,
            'retry_attempts': self.scraper_retry_attempts,
            'user_agent_pool_file': self.scraper_user_agent_pool_file,
            'proxy_pool_file': self.scraper_proxy_pool_file,
            'proxy_enabled': self.scraper_proxy_enabled,
            'proxy_rotation_after': self.scraper_proxy_rotation_after,
            'use_playwright': self.scraper_use_playwright,
            'playwright_headless': self.scraper_playwright_headless,
            'disable_web_security': self.scraper_disable_web_security,
            'verify_ssl': self.scraper_verify_ssl,
            'cookies_file': self.scraper_cookies_file,
        }

    @property
    def sokogate(self) -> dict:
        return {
            'base_url': self.sokogate_base_url,
            'listing_path': self.sokogate_listing_path,
            'product_path': self.sokogate_product_path,
        }

    @property
    def redis(self) -> dict:
        return {'url': self.redis_url}

    @property
    def postgres(self) -> dict:
        return {
            'host': self.postgres_host,
            'port': self.postgres_port,
            'user': self.postgres_user,
            'password': self.postgres_password,
            'db': self.postgres_db,
            'pool_size': self.postgres_pool_size,
            'max_overflow': self.postgres_max_overflow,
        }


settings = ScraperConfig()
