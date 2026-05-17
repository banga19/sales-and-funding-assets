"""
Celery application for the Sokogate scraper.

Jobs
────
full_scrape         — crawl full catalogue (triggered by POST /api/v1/scrape/trigger
                      or by Celery Beat on the daily schedule)
price_alert_sweep   — check freshly scraped prices and emit alerts
health_check       — verify DB / Redis / site reachability
nightly_cleanup    — soft-delete products not seen in N days

Beat schedule (set CELERY_BEAT_ENABLED=true via .env)
──────────────────────────────────────────────────────
full_scrape       — daily at CELERY_FULL_SCRAPE_MINUTE/CELERY_FULL_SCRAPE_HOUR (default 02:00 UTC)
price_alert_sweep — every 2 hours
health_check     — every 30 minutes
nightly_cleanup  — 03:30 UTC every night
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from celery import Celery
from celery.schedules import crontab
import structlog

# ── Environment / config ─────────────────────────────────────────────────────────

import sys, pathlib as _pl
_SRC = str(_pl.Path(__file__).resolve().parents[2])
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from sokogate_scraper.config import settings
from celery.signals import task_prerun, task_postrun, task_failure

log = structlog.get_logger()

# ── Celery app ───────────────────────────────────────────────────────────────────

celery_app = Celery(
    "sokogate_scraper",
    broker      = settings.celery.broker_url,
    backend     = settings.celery.result_backend,
    include     = [
        "sokogate_scraper.scheduler.tasks",
    ],
)

# ── Celery Beat schedule ─────────────────────────────────────────────────────────

_celery_beat_schedule: dict[str, Any] = {}

if settings.celery.beat_enabled:
    from sokogate_scraper.scheduler.tasks import (
        full_scrape,
        price_alert_sweep,
        health_check,
        nightly_cleanup,
    )

    _celery_beat_schedule = {
        "full-scrape-daily": {
            "task":    "sokogate_scraper.scheduler.tasks.full_scrape",
            "schedule": crontab(
                minute = int(settings.celery.full_scrape_minute),
                hour   = int(settings.celery.full_scrape_hour),
            ),
            "args":    [settings.sokogate.base_url,
                        settings.scraper.max_pages_per_run,
                        settings.scraper.max_products_per_run],
            "kwargs":  {},
        },
        "price-alert-sweep": {
            "task":    "sokogate_scraper.scheduler.tasks.price_alert_sweep",
            "schedule": crontab(minute="0", hour="*/2"),  # every 2 hours
            "args":    [0.05],  # 5 % minimum price-change threshold
            "kwargs":  {},
        },
        "health-check": {
            "task":    "sokogate_scraper.scheduler.tasks.health_check",
            "schedule": crontab(minute="*/30"),  # every 30 minutes
            "args":    [],
            "kwargs":  {},
        },
        "nightly-cleanup": {
            "task":    "sokogate_scraper.scheduler.tasks.nightly_cleanup",
            "schedule": crontab(minute="30", hour="3"),  # 03:30 UTC
            "args":    [90],  # soft-delete products not seen in 90 days
            "kwargs":  {},
        },
    }

celery_app.conf.beat_schedule = _celery_beat_schedule
celery_app.conf.task_routes = {
    "sokogate_scraper.scheduler.tasks.*": {"queue": "scraper"},
}
celery_app.conf.task_default_queue   = "scraper"
celery_app.conf.task_default_exchange = "scraper"
celery_app.conf.task_default_routing_key = "scraper"
celery_app.conf.timezone = "UTC"
celery_app.conf.worker_max_tasks_per_child  = 100   # restart worker process every 100 tasks
celery_app.conf.worker_prefetch_multiplier  = 1     # fair scheduling
celery_app.conf.task_acks_late              = True  # don't acknowledge until task finishes
celery_app.conf.task_reject_on_worker_lost   = True

# ── Lifecycle signals ────────────────────────────────────────────────────────────

@task_prerun.connect
def task_prerun_handler(sender=None, task_id=None, task=None, **kwargs):
    log.info("celery.task.started", task=task.name if task else "unknown", task_id=task_id)


@task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, retval=None, **kwargs):
    log.info("celery.task.completed",
             task=task.name if task else "unknown",
             task_id=task_id,
             result_type=type(retval).__name__)


@task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, **kwargs):
    log.error("celery.task.failed",
              task=sender.name if sender else "unknown",
              task_id=task_id,
              error=str(exception))


# ── Entrypoints ──────────────────────────────────────────────────────────────────

def run_worker(concurrency: int = 4) -> None:
    """Start a Celery worker (blocks)."""
    celery_app.worker_main(
        argv=["worker", "--loglevel=info", f"--concurrency={concurrency}"]
        )


def run_beat() -> None:
    """Start Celery Beat scheduler (blocks)."""
    celery_app.Beat(
        loglevel="info",
        schedule_filename="/tmp/celerybeat-schedule.db",
    ).run()
