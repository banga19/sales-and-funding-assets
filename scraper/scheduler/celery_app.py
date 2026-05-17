"""
Celery application for the Sokogate scraper.

Jobs
────
full_scrape           — crawl full catalogue (triggered by POST /api/v1/scrape/trigger
                        or by Celery Beat on the daily schedule)
refresh_single       — re-scrape one product on demand
price_alert_sweep    — check freshly scraped prices and emit alerts
sync_tags            — sync WooCommerce product tags into product.tags[]
health_check        — verify DB / Redis / Playwright / network reachability

Beat schedule (set CELERY_BEAT_ENABLED=true)
─────────────────────────────────────────────────
full_scrape      — 02:00 UTC every day (Sokogate is in EAT = UTC+3, agents run at 5 AM EAT)
price_alert_sweep— every 2 hours
health_check     — every 30 minutes
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any

from celery import Celery
from celery.schedules import crontab
import structlog

# ── Environment / config ────────────────────────────────────────────────────────
import sys, pathlib as _pl
_SRC = str(_pl.Path(__file__).resolve().parents[1])
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from sokogate_scraper.config import settings
from sokogate_scraper.db.postgres import get_engine, get_session_factory, ScrapeRunORM, ProductORM
from celery.signals import task_prerun, task_postrun, task_failure

# ── Celery app ─────────────────────────────────────────────────────────────────

celery_app = Celery(
    "sokogate_scraper",
    broker      = settings.celery.broker_url,
    backend     = settings.celery.result_backend,
    include     = [
        "sokogate_scraper.scheduler.tasks",
    ],
)

# ── Celery Beat schedule ────────────────────────────────────────────────────────

celery_app.conf.beat_schedule = {}

if settings.celery.beat_enabled:
    from sokogate_scraper.scheduler.tasks import full_scrape, price_alert_sweep, health_check, nightly_cleanup

    celery_app.conf.beat_schedule = {
        "full-scrape-daily": {
            "task":    "sokogate_scraper.scheduler.tasks.full_scrape",
            "schedule": crontab(
                minute = int(settings.celery.full_scrape_schedule_minute),
                hour   = int(settings.celery.full_scrape_schedule_hour),
            ),
            "args":    [settings.sokogate.base_url, settings.scraper.max_pages_per_run, settings.scraper.max_products_per_run],
            "kwargs":  {},
        },
        "price-alert-sweep": {
            "task":    "sokogate_scraper.scheduler.tasks.price_alert_sweep",
            "schedule": crontab(minute="0", hour="*/2"),  # every 2 hours
            "args":    [0.05],  # 5% minimum change
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

celery_app.conf.task_routes = {
    "sokogate_scraper.scheduler.tasks.*": {"queue": "scraper"},
}
celery_app.conf.task_default_queue = "scraper"
celery_app.conf.task_default_exchange = "scraper"
celery_app.conf.task_default_routing_key = "scraper"
celery_app.conf.timezone = "UTC"
celery_app.conf.worker_max_tasks_per_child = 100   # restart worker process every 100 tasks (memory leak guard)
celery_app.conf.worker_prefetch_multiplier = 1     # fair scheduling when one product is heavy
celery_app.conf.task_acks_late = True              # don't acknowledge until task finishes
celery_app.conf.task_reject_on_worker_lost = True

log = structlog.get_logger()


# ── Lifecycle signals ───────────────────────────────────────────────────────────

@task_prerun.connect
def task_prerun_handler(sender=None, task_id=None, task=None, **kwargs):
    log.info("celery.task.started", task=task.name, task_id=task_id)


@task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, retval=None, **kwargs):
    log.info("celery.task.completed", task=task.name, task_id=task_id, result_type=type(retval).__name__)


@task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, **kwargs):
    log.error("celery.task.failed", task=sender.name if sender else "unknown", task_id=task_id, error=str(exception))


# ── Entrypoints ─────────────────────────────────────────────────────────────────

def run_worker() -> None:
    """Start a Celery worker (blocks)."""
    celery_app.worker_main(
        argv=["worker", "--loglevel=info", "--concurrency=4"]
    )


def run_beat() -> None:
    """Start Celery Beat scheduler (blocks)."""
    celery_app.Beat(
        loglevel="info",
        schedule_filename="/tmp/celerybeat-schedule.db",
    ).run()
