"""
Celery application for the Sokogate scraper.
"""

from __future__ import annotations

import sys
import pathlib as _pl

# Ensure the scraper root (sokogate_scraper/) is on sys.path so that
# imports like `from sokogate_scraper.config import settings` resolve
# regardless of where poetry / celery-beat invoke this file from.
_src = str(_pl.Path(__file__).resolve().parents[1])
if _src not in sys.path:
    sys.path.insert(0, _src)

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

from celery import Celery
from celery.schedules import crontab

# Import after sys.path adjustment
import structlog
log = structlog.get_logger()

from sokogate_scraper.config import settings

celery_app = Celery(
    "sokogate_scraper",
    broker      = settings.celery.broker_url,
    backend     = settings.celery.result_backend,
    include     = ["sokogate_scraper.scheduler.tasks"],
)

# ── Beat schedule ─────────────────────────────────────────────────────────────

celery_app.conf.beat_schedule = (
    {
        "full-scrape-daily": {
            "task":    "sokogate_scraper.scheduler.tasks.full_scrape",
            "schedule": crontab(
                minute  = int(settings.celery.full_scrape_minute),
                hour    = int(settings.celery.full_scrape_hour),
            ),
            "args":    [settings.sokogate.base_url, settings.scraper.max_pages_per_run, settings.scraper.max_products_per_run],
        },
        "price-alert-sweep": {
            "task":    "sokogate_scraper.scheduler.tasks.price_alert_sweep",
            "schedule": crontab(minute="0", hour="*/2"),
            "args":    [0.05],
        },
        "health-check": {
            "task":    "sokogate_scraper.scheduler.tasks.health_check",
            "schedule": crontab(minute="*/30"),
            "args":    [],
        },
        "nightly-cleanup": {
            "task":    "sokogate_scraper.scheduler.tasks.nightly_cleanup",
            "schedule": crontab(minute="30", hour="3"),
            "args":    [90],
        },
    }
    if settings.celery.beat_enabled
    else {}
)

celery_app.conf.task_routes         = {"sokogate_scraper.scheduler.tasks.*": {"queue": "scraper"}}
celery_app.conf.task_default_queue = "scraper"
celery_app.conf.task_acks_late     = True
celery_app.conf.task_reject_on_worker_lost = True
celery_app.conf.worker_max_tasks_per_child       = 100
celery_app.conf.worker_prefetch_multiplier       = 1
celery_app.conf.timezone                          = "UTC"


# ── Entrypoints ────────────────────────────────────────────────────────────────

def run_worker(concurrency: int = 4) -> None:
    """Start a Celery worker (blocks)."""
    celery_app.worker_main(
        argv=["worker", "--loglevel=info", f"--concurrency={concurrency}"]
    )


def run_beat() -> None:
    """Start Celery Beat (blocks)."""
    celery_app.Beat(loglevel="info").run()
