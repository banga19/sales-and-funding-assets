"""
Celery tasks triggered by celery_app beat schedule or the API endpoint.
Each task writes ScrapeRun / PriceHistory / ScrapeError rows to PostgreSQL.

Requires Python >= 3.11 (pyproject.toml); test against 3.11+ before deploy.
"""

from __future__ import annotations

import asyncio
import time
import traceback
from datetime import datetime, timezone, timedelta
from typing import Any

from celery import shared_task, states
import structlog

log = structlog.get_logger()


# ═══════════════════════════════════════════════════════════════════════════════
# Core orchestration
# ═══════════════════════════════════════════════════════════════════════════════

async def _run_full_scrape(
    base_url:    str,
    max_pages:   int,
    max_products: int,
) -> dict[str, Any]:
    """
    Orchestrates a full-catalogue scrape run in 5 phases:

    1. Create a ScrapeRun audit row (status=running, phase=discovering).
    2. Discover product detail-page URLs by crawling listing/category pages.
    3. Parse each detail page via the WooCommerce selector set.
    4. Upsert every parsed dict into the products table (INSERT new / UPDATE existing).
    5. Append rows to price_history when price_current has changed.
    6. Soft-delete products previously active but not found this run.
    7. Finalise the ScrapeRun row with counts + duration.
    """
    from sokogate_scraper.config import settings
    from sqlalchemy import select, and_, func
    from sokogate_scraper.db.postgres import (
        get_engine,
        get_session_factory,
        ScrapeRunORM,
        ProductORM,
        PriceHistoryORM,
        ScrapeErrorORM,
    )
    from sokogate_scraper.stealth.user_agents import UserAgentPool
    from sokogate_scraper.stealth.proxy_rotation import ProxyPool
    from sokogate_scraper.stealth.rate_limiter import TokenBucket
    from sokogate_scraper.parsers.woocommerce import WooCommerceParser

    engine       = get_engine(settings.database_url)
    session_fac  = get_session_factory(engine)
    start_ts     = time.monotonic()
    started_at   = datetime.now(timezone.utc)

    ua_pool     = UserAgentPool(settings.scraper.user_agent_pool_file)
    proxy_pool  = ProxyPool(settings.scraper.proxy_pool_file) if settings.scraper.proxy_enabled else None
    limiter     = TokenBucket(
        rate  = settings.scraper.max_concurrency,
        burst = settings.scraper.max_concurrency,
    )

    run_id    = None
    parser    = None

    # ── Phase 0: create the ScrapeRun audit row ──────────────────────────────────
    with session_fac() as outer:
        run = ScrapeRunORM(
            started_at = started_at,
            status     = "running",
            phase      = "discovering",
            base_url   = base_url,
            user_agent = ua_pool.get(),
            proxy_used = proxy_pool.current() if proxy_pool else None,
        )
        outer.add(run)
        outer.commit()
        run_id      = str(run.id)
        outer.expunge(run)

    log.info("scrape_run.created", run_id=run_id)

    # Everything below uses per-phase error handling so there is no single
    # outer try/except (avoids a cp3100a specific parser issue).

    # ── Phase 1: initialise parser and discover product URLs ─────────────────────
    product_urls = []
    scraped      = []
    failed_urls  = []

    try:
        parser = WooCommerceParser(
            base_url        = base_url,
            max_pages       = max_pages,
            max_products    = max_products,
            user_agent_pool = ua_pool,
            proxy_pool      = proxy_pool,
            limiter         = limiter,
            run_id          = run_id,
            verify_ssl      = settings.scraper.verify_ssl,
        )

        with session_fac() as session:
            session.query(ScrapeRunORM).filter(ScrapeRunORM.id == run_id).update(
                {"phase": "discovering", "phase_message": "Discovering product URLs…"}
            )
            session.commit()

        product_urls = await parser.discover_product_urls()
        log.info("discovery.complete", run_id=run_id, urls_found=len(product_urls))

        with session_fac() as session:
            session.query(ScrapeRunORM).filter(ScrapeRunORM.id == run_id).update(
                {"products_found": len(product_urls)}
            )
            session.commit()

    except Exception as exc:
        _fail_run(run_id, session_fac, exc, parser)
        raise

    # ── Phase 2: scrape each detail page ─────────────────────────────────────────
    try:
        with session_fac() as session:
            session.query(ScrapeRunORM).filter(ScrapeRunORM.id == run_id).update(
                {"phase": "scraping", "phase_message": f"Scraping 0/{len(product_urls)}"}
            )
            session.commit()

        for i, product_url in enumerate(product_urls[:max_products]):
                try:
                    result = await parser.parse_detail_page(product_url, run_id)
                    if result:
                        scraped.append(result)
                except Exception as exc:
                    failed_urls.append(product_url)
                    log.warning("scrape.product_failed", url=product_url, error=str(exc))
                    _record_scrape_error(run_id, product_url, exc)
                finally:
                    with session_fac() as session:
                        session.query(ScrapeRunORM).filter(ScrapeRunORM.id == run_id).update(
                            {"phase_message": f"Scraping {i + 1}/{len(product_urls)}"}
                        )
                        session.commit()

        log.info("scraping.complete",
                 run_id  = run_id,
                 scraped = len(scraped),
                 failed  = len(failed_urls))

    except Exception as exc:
        _fail_run(run_id, session_fac, exc, parser)
        raise

    # ── Phase 3: upsert into products table ──────────────────────────────────────
    products_new      = 0
    products_updated  = 0
    products_deleted  = 0
    products_seen_urls: set[str] = set()

    try:
        with session_fac() as session:
            for data in scraped:
                surl = data["source_url"]
                products_seen_urls.add(surl)

                from sqlalchemy.dialects.postgresql import insert as pg_insert

                stmt = pg_insert(ProductORM.__table__).values(
                    source_url      = surl,
                    name            = data["name"],
                    description     = data.get("description"),
                    category        = data.get("category", "General"),
                    sku             = data.get("sku"),
                    price_current   = data.get("price_numeric"),
                    price_raw       = data.get("price_raw"),
                    currency        = data.get("currency", "KES"),
                    in_stock        = data.get("in_stock", True),
                    images          = data.get("images", []),
                    specifications  = data.get("specifications", {}),
                    attributes      = data.get("attributes", {}),
                    variations      = data.get("variations", []),
                    tags            = data.get("tags", []),
                    last_scraped_at = datetime.now(timezone.utc),
                    is_active       = True,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements = ["source_url"],
                    set_={
                        "name":            data["name"],
                        "description":     data.get("description"),
                        "category":        data.get("category", "General"),
                        "sku":             data.get("sku"),
                        "price_current":   data.get("price_numeric"),
                        "price_raw":       data.get("price_raw"),
                        "in_stock":        data.get("in_stock", True),
                        "images":          data.get("images", []),
                        "specifications":  data.get("specifications", {}),
                        "attributes":      data.get("attributes", {}),
                        "variations":      data.get("variations", []),
                        "tags":            data.get("tags", []),
                        "last_scraped_at": datetime.now(timezone.utc),
                        "is_active":       True,
                    },
                )
                before = session.execute(
                    select(ProductORM).where(ProductORM.source_url == surl)
                ).scalar_one_or_none()

                session.execute(stmt)
                if before is None:
                    products_new += 1
                else:
                    products_updated += 1

            seen_ids = session.execute(
                select(ProductORM.id)
                .where(ProductORM.source_url.in_(list(products_seen_urls)))
            ).scalars().all()
            seen_set = {str(x) for x in seen_ids}

            all_active = session.execute(
                select(ProductORM.id)
                .where(ProductORM.is_active == True)
            ).scalars().all()
            to_deactivate = {str(x) for x in all_active} - seen_set
            if to_deactivate:
                session.execute(
                    ProductORM.__table__.update()
                    .where(ProductORM.id.in_(to_deactivate))
                    .values(is_active=False)
                )
                products_deleted = len(to_deactivate)
            else:
                products_deleted = 0

            session.commit()

        log.info("upsert.complete",
                 new     = products_new,
                 updated = products_updated,
                 deleted = products_deleted)

    except Exception as exc:
        _fail_run(run_id, session_fac, exc, parser)
        raise

    # ── Phase 4: price history ────────────────────────────────────────────────────
    try:
        with session_fac() as session:
            all_current = (
                session.execute(
                    select(ProductORM.source_url, ProductORM.price_current, ProductORM.id)
                    .where(ProductORM.source_url.in_(list(products_seen_urls)))
                )
                .all()
            )
            price_map = {
                r[0]: (float(r[1]) if r[1] is not None else None, r[2])
                for r in all_current
            }

            ph_rows: list[PriceHistoryORM] = []
            for data in scraped:
                surl    = data["source_url"]
                cur_px  = data.get("price_numeric")
                prev_px = price_map.get(surl, (None, None))[0]
                if (
                    prev_px is not None
                    and cur_px is not None
                    and abs(prev_px - cur_px) > 0.001
                ):
                    ph_rows.append(
                        PriceHistoryORM(
                            product_id    = price_map.get(surl, (None, None))[1],
                            price         = cur_px,
                            currency      = data.get("currency", "KES"),
                            in_stock      = data.get("in_stock", True),
                            scrape_run_id = run_id,
                            raw_price     = data.get("price_raw"),
                        )
                    )
            if ph_rows:
                session.add_all(ph_rows)
                session.commit()
                log.info("price_history.written", count=len(ph_rows))

    except Exception as exc:
        log.warning("scrape.price_history.failed", run_id=run_id, error=str(exc))

    # ── Phase 5: finalise ScrapeRun ─────────────────────────────────────────────────
    duration_ms = int((time.monotonic() - start_ts) * 1000)
    finished_at = datetime.now(timezone.utc)

    try:
        with session_fac() as session:
            run_row = session.get(ScrapeRunORM, run_id)
            if run_row:
                run_row.status           = "completed" if not failed_urls else "partial"
                run_row.phase            = "complete"
                run_row.phase_message    = (
                    f"Done — {len(scraped)} scraped, {len(failed_urls)} failed"
                )
                run_row.finished_at      = finished_at
                run_row.products_scraped = len(scraped)
                run_row.products_failed  = len(failed_urls)
                run_row.products_new     = products_new
                run_row.products_updated = products_updated
                run_row.products_deleted = products_deleted
                run_row.duration_ms      = duration_ms
                run_row.page_fetches     = parser.http_get_count if parser else 0
                session.commit()

    except Exception as exc:
        _fail_run(run_id, session_fac, exc, parser)

    log.info("scrape_run.finalized",
             run_id        = run_id,
             total_scraped = len(scraped))
    return {
        "run_id"          : run_id,
        "total_scraped"   : len(scraped),
        "total_failed"    : len(failed_urls),
        "products_new"    : products_new,
        "products_updated": products_updated,
        "products_deleted": products_deleted,
        "duration_seconds": duration_ms / 1000,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════════════════════════════════

def _fail_run(
    run_id:    str | None,
    SFactory:  Any,
    exc:       Exception,
    parser:    Any | None,
) -> None:
    """Mark the current ScrapeRun as failed — always best-effort."""
    try:
        session = SFactory()
        run_row = session.get(ScrapeRunORM, run_id)
        if run_row:
            run_row.status         = "failed"
            run_row.phase          = "error"
            run_row.phase_message  = str(exc)
            run_row.finished_at    = datetime.now(timezone.utc)
            run_row.duration_ms    = int(time.monotonic())
            run_row.error_message  = traceback.format_exc()
            if parser:
                run_row.page_fetches = parser.http_get_count
            session.commit()
        session.close()
        log.error("scrape_run.failed", run_id=run_id, error=str(exc))
    except Exception as inner:
        log.warning("scrape.fail_handler.error", run_id=run_id, error=str(inner))


def _record_scrape_error(
    run_id: str | None,
    url:    str,
    exc:    Exception,
) -> None:
    """Best-effort: insert a row into the scrape_errors table."""
    try:
        from sokogate_scraper.db.postgres import (
            get_engine,
            get_session_factory,
            ScrapeErrorORM,
        )
        import re as _re

        engine = get_engine()
        SF     = get_session_factory(engine)
        with SF() as session:
            session.add(
                ScrapeErrorORM(
                    scrape_run_id = run_id,
                    product_url   = url,
                    error_type    = _classify_error(exc),
                    error_message = str(exc),
                    http_status   = _extract_http_status(exc),
                    stack_trace   = traceback.format_exc(),
                )
            )
            session.commit()
    except Exception as inner:
        log.warning("scrape_error.record_failed", url=url, error=str(inner))


def _classify_error(exc: Exception) -> str:
    name = type(exc).__name__.lower()
    msg  = str(exc).lower()
    if "timeout" in name or "timeout" in msg:
        return "timeout"
    if any(s in msg for s in ("403", "forbidden", "cloudflare", "challenge")):
        return "forbidden"
    if any(s in msg for s in ("429", "too many requests", "rate limit")):
        return "rate_limited"
    if any(s in msg for s in ("connection", "dns", "resolve", "network")):
        return "network_error"
    if "json" in name or "decode" in name:
        return "parse_error"
    return "unknown"


def _extract_http_status(exc: Exception) -> int | None:
    msg = str(exc)
    m = __import__("re").search(r"(\d{3})", msg)
    code = int(m.group(1)) if m else None
    if code and 400 <= code < 600:
        return code
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# Shared task wrappers
# ═══════════════════════════════════════════════════════════════════════════════

@shared_task(bind=True, name="sokogate_scraper.scheduler.tasks.full_scrape")
def full_scrape(
    self,
    base_url:     str = settings.sokogate.base_url,
    max_pages:    int = settings.scraper.max_pages_per_run,
    max_products: int = settings.scraper.max_products_per_run,
) -> dict[str, Any]:
    """Celery task: full-catalogue scrape."""
    self.update_state(state=states.STARTED, meta={"phase": "running", "message": "Starting…"})
    result = asyncio.run(
        _run_full_scrape(base_url, max_pages, max_products)
    )
    self.update_state(state=states.SUCCESS, meta=result)
    return result


@shared_task(bind=True, name="sokogate_scraper.scheduler.tasks.price_alert_sweep")
def price_alert_sweep(self, min_change_pct: float = 5.0) -> dict[str, Any]:
    """
    Alert on products whose price changed by more than ``min_change_pct``%
    in the last 24 h.
    """
    from sokogate_scraper.db.postgres import get_engine, get_session_factory, ProductORM
    from sqlalchemy import select, and_

    engine    = get_engine(settings.database_url)
    SF        = get_session_factory(engine)
    cutoff_dt = datetime.now(timezone.utc) - timedelta(hours=24)
    threshold = float(min_change_pct) / 100.0
    alerts:    list[dict] = []

    try:
        with SF() as session:
            recent = session.execute(
                select(
                    ProductORM.id,
                    ProductORM.name,
                    ProductORM.source_url,
                    ProductORM.price_current,
                )
                .where(
                    and_(
                        ProductORM.is_active      == True,
                        ProductORM.last_scraped_at >= cutoff_dt,
                        ProductORM.price_current.is_not(None),
                    )
                )
            ).all()

            for pid, name, url, new_px in recent:
                old_row = session.execute(
                    select(ProductORM.price_current)
                    .where(
                        and_(
                            ProductORM.id == pid,
                            ProductORM.last_scraped_at < cutoff_dt,
                        )
                    )
                    .order_by(ProductORM.last_scraped_at.desc())
                    .limit(1)
                ).scalar_one_or_none()

                if old_row is None:
                    continue
                old_px   = float(old_row)
                new_dec  = float(new_px)
                if old_px == 0:
                    continue
                pct_change = abs(new_dec - old_px) / old_px
                if pct_change < threshold:
                    continue
                alerts.append({
                    "product_id": str(pid),
                    "name":       name,
                    "url":        url,
                    "old_price":  old_px,
                    "new_price":  new_dec,
                    "pct_change": round(pct_change * 100, 2),
                    "direction":  "up" if new_dec > old_px else "down",
                    "currency":   "KES",
                })
    except Exception as exc:
        log.error("price_alert_sweep.failed", error=str(exc))
        raise

    log.info("price_alert_sweep", alerts_triggered=len(alerts), window_hours=24)
    self.update_state(state=states.SUCCESS, meta={"alerts_triggered": len(alerts)})
    return {"alerts_checked": len(recent), "alerts_triggered": len(alerts), "alerts": alerts}


@shared_task(bind=True, name="sokogate_scraper.scheduler.tasks.health_check")
def health_check(self) -> dict[str, Any]:
    """Verify DB / Redis / site reachability."""
    checks: dict[str, bool | str] = {}

    try:
        from sokogate_scraper.db.postgres import get_engine
        eng = get_engine(settings.database_url)
        with eng.connect() as conn:
            conn.execute(eng.text("SELECT 1"))
        checks["database"] = True
    except Exception as exc:
        checks["database"] = str(exc)

    try:
        import redis as redis_mod
        r = redis_mod.from_url(settings.celery.broker_url)
        r.ping()
        checks["redis"] = True
    except Exception as exc:
        checks["redis"] = str(exc)

    try:
        import httpx
        resp = httpx.head(
            settings.sokogate.base_url,
            timeout   = 10,
            follow_redirects = True,
            verify    = settings.scraper.verify_ssl,
        )
        checks["sokogate_http"] = resp.status_code < 500
    except Exception as exc:
        checks["sokogate_http"] = str(exc)

    all_ok = all(v is True for v in checks.values())
    log.info("health_check", checks=checks, healthy=all_ok)
    return {"healthy": all_ok, "checks": checks,
            "checked_at": datetime.now(timezone.utc).isoformat()}


@shared_task(bind=True, name="sokogate_scraper.scheduler.tasks.nightly_cleanup")
def nightly_cleanup(self, days_inactive: int = 90) -> dict[str, Any]:
    """
    Soft-delete products not seen in ``days_inactive`` days.
    Run nightly at 03:30 UTC via Celery Beat.
    """
    from sokogate_scraper.db.postgres import get_engine, get_session_factory, ProductORM
    from sqlalchemy import and_

    threshold = datetime.now(timezone.utc) - timedelta(days=days_inactive)
    engine    = get_engine(settings.database_url)
    SF        = get_session_factory(engine)

    try:
        with SF() as session:
            stmt = (
                ProductORM.__table__.update()
                .where(
                    and_(
                        ProductORM.is_active       == True,
                        ProductORM.last_scraped_at < threshold,
                    )
                )
                .values(is_active=False)
            )
            result = session.execute(stmt)
            session.commit()
            soft_deleted = result.rowcount

        log.info("nightly_cleanup", soft_deleted=soft_deleted, threshold_days=days_inactive)
        return {"soft_deleted": soft_deleted, "threshold_days": days_inactive}

    except Exception as exc:
        log.error("nightly_cleanup.failed", error=str(exc))
        return {"soft_deleted": 0, "threshold_days": days_inactive, "error": str(exc)}
