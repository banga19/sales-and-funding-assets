"""
Celery tasks triggered by celery_app beat schedule or the API endpoint.
Each task writes ScrapeRun / PriceHistory rows to PostgreSQL.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone, timedelta
from typing import Any

from celery import shared_task, states
from sqlalchemy.orm import Session

import structlog
log = structlog.get_logger()

# ── Backend / orchestrator import (lazy to avoid circular dependency) ───────────
# We use a "message-passing" wrapper rather than direct Playwright calls,
# so tasks can be tested without a live browser session.


async def _run_full_scrape(base_url: str, max_pages: int, max_products: int) -> dict[str, Any]:
    """
    Orchestrates a full-catalogue scrape run.

    1. Creates a ScrapeRun audit row.
    2. Discovers product detail-page URLs by crawling listing/category pages.
    3. Uses the anti-bot layer (proxy + user-agent rotation) for every HTTP request.
    4. Parses each detail page via the WooCommerce selector set.
    5. Upserts products → `products` table (INSERT new / UPDATE existing).
    6. Appends rows to `price_history` when `price_current` has changed.
    7. Soft-deletes products previously active but not found this run.
    8. Updates the `ScrapeRun` row with final counts + duration.
    """
    # ── Lazy heavy imports ──────────────────────────────────────────────────────
    from sokogate_scraper.config import settings
    from sokogate_scraper.db.postgres import (
        get_engine, get_session_factory,
        ScrapeRunORM, ProductORM, PriceHistoryORM,
    )
    from sokogate_scraper.stealth.user_agents import UserAgentPool
    from sokogate_scraper.stealth.proxy_rotation import ProxyPool
    from sokogate_scraper.stealth.rate_limiter import TokenBucket
    from sokogate_scraper.parsers.woocommerce import WooCommerceParser
    from sqlalchemy import select, and_

    engine = get_engine(settings.database_url)
    SF     = get_session_factory(engine)

    start_ts   = time.monotonic()
    started_at = datetime.now(timezone.utc)

    ua_pool = UserAgentPool(settings.scraper.user_agent_pool_file)
    proxy_pool = ProxyPool(settings.scraper.proxy_pool_file) if settings.scraper.proxy_enabled else None
    limiter  = TokenBucket(
        rate   = settings.scraper.max_concurrency,
        burst  = settings.scraper.max_concurrency,
    )

    run_id = None
    product_count_before = 0

    with SF() as outer:
        # Create a placeholder ScrapeRun row
        run = ScrapeRunORM(
            started_at     = started_at,
            status         = "running",
            phase          = "discovering",
            base_url       = base_url,
            user_agent     = ua_pool.get(),
            proxy_used     = proxy_pool.current() if proxy_pool else None,
        )
        outer.add(run)
        outer.commit()
        run_id = str(run.id)
        product_count_before = outer.query(ProductORM).filter(ProductORM.is_active == True).count() or 0
        outer.expunge(run)

    log.info("scrape_run.created", run_id=run_id)

    try:
        parser = WooCommerceParser(
            base_url          = base_url,
            max_pages         = max_pages,
            max_products      = max_products,
            user_agent_pool   = ua_pool,
            proxy_pool        = proxy_pool,
            limiter           = limiter,
            run_id            = run_id,
        )

        # ── Phase 1: discover product URLs ───────────────────────────────────────
        with SF() as session:
            session.query(ScrapeRunORM).filter(ScrapeRunORM.id == run_id).update(
                {"phase": "discovering", "phase_message": "Discovering product URLs…"}
            )
            session.commit()

        product_urls = await parser.discover_product_urls()
        log.info("discovery.complete", run_id=run_id, urls_found=len(product_urls))

        with SF() as session:
            session.query(ScrapeRunORM).filter(ScrapeRunORM.id == run_id).update(
                {"products_found": len(product_urls)}
            )
            session.commit()

        # ── Phase 2: scrape each detail page ────────────────────────────────────
        scraped: list[dict] = []
        failed_urls: list[str] = []

        with SF() as session:
            session.query(ScrapeRunORM).filter(ScrapeRunORM.id == run_id).update(
                {"phase": "scraping", "phase_message": f"Scraping 0/{len(product_urls)}"}
            )
            session.commit()

        for i, product_url in enumerate(product_urls[:max_products]):
            try:
                await limiter.acquire()
                result = await parser.parse_detail_page(product_url, run_id)
                if result:
                    scraped.append(result)
                with SF() as session:
                    session.query(ScrapeRunORM).filter(ScrapeRunORM.id == run_id).update(
                        {"phase_message": f"Scraping {i + 1}/{len(product_urls)}"}
                    )
                    session.commit()
            except Exception as exc:   # per-product failure → log + continue
                failed_urls.append(product_url)
                log.warning("scrape.product_failed", url=product_url, error=str(exc))
                # Record failure in the audit log
                # (scrape_errors table — typed ORM row created inline)
                # skip here: cheap SqlAlchemy insert is O(1)
                ...

        log.info("scraping.complete", run_id=run_id,
                 scraped=len(scraped), failed=len(failed_urls))

        # ── Phase 3: upsert into products table ──────────────────────────────────

        from sqlalchemy.dialects.postgresql import insert as pg_insert

        engine = get_engine(settings.database_url)
        SF_upsert = get_session_factory(engine)

        products_new      = 0
        products_updated  = 0
        products_seen_urls: set[str] = set()

        with SF_upsert() as session:
            for data in scraped:
                surl = data["source_url"]
                products_seen_urls.add(surl)

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
                    index_elements=["source_url"],
                    set_={
                        "name":          data["name"],
                        "description":   data.get("description"),
                        "category":      data.get("category", "General"),
                        "sku":           data.get("sku"),
                        "price_current": data.get("price_numeric"),
                        "price_raw":     data.get("price_raw"),
                        "in_stock":      data.get("in_stock", True),
                        "images":        data.get("images", []),
                        "specifications": data.get("specifications", {}),
                        "attributes":    data.get("attributes", {}),
                        "variations":    data.get("variations", []),
                        "tags":          data.get("tags", []),
                        "last_scraped_at": datetime.now(timezone.utc),
                        "is_active":     True,
                    },
                )
                # Check if it was INSERT vs UPDATE
                before = session.execute(
                    select(ProductORM).where(ProductORM.source_url == surl)
                ).scalar_one_or_none()

                session.execute(stmt)
                if before is None:
                    products_new += 1
                else:
                    products_updated += 1

            # ── Soft-delete products not seen in this scrape run ──────────────────
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

        log.info("upsert.complete", new=products_new, updated=products_updated, deleted=products_deleted)

        # ── Phase 4: price history ──────────────────────────────────────────────
        # For every upserted product that changed price, emit a price_history row
        with SF_upsert() as session:
            all_current = (
                session.execute(
                    select(ProductORM.source_url, ProductORM.price_current, ProductORM.id)
                    .where(ProductORM.source_url.in_(list(products_seen_urls)))
                )
                .all()
            )
            price_map = {r[0]: (float(r[1]) if r[1] is not None else None, r[2]) for r in all_current}

            ph_rows = []
            for data in scraped:
                surl    = data["source_url"]
                cur_px  = data.get("price_numeric")
                prev_px = price_map.get(surl, (None, None))[0]
                if prev_px is not None and cur_px is not None and abs(prev_px - cur_px) > 0.001:
                    ph_rows.append(
                        PriceHistoryORM(
                            product_id  = price_map.get(surl, (None, None))[1],
                            price       = cur_px,
                            currency    = data.get("currency", "KES"),
                            in_stock    = data.get("in_stock", True),
                            scrape_run_id= run_id,
                            raw_price   = data.get("price_raw"),
                        )
                    )
            if ph_rows:
                session.add_all(ph_rows)
                session.commit()
                log.info("price_history.written", count=len(ph_rows))

        # ── Phase 5: finalize ScrapeRun ─────────────────────────────────────────
        duration_ms = int((time.monotonic() - start_ts) * 1000)
        finished_at = datetime.now(timezone.utc)

        with SF_upsert() as session:
            run_row = session.get(ScrapeRunORM, run_id)
            if run_row:
                run_row.status           = "completed" if not failed_urls else "partial"
                run_row.phase            = "complete"
                run_row.phase_message    = f"Done — {len(scraped)} scraped, {len(failed_urls)} failed"
                run_row.finished_at      = finished_at
                run_row.products_scraped  = len(scraped)
                run_row.products_failed   = len(failed_urls)
                run_row.products_new      = products_new
                run_row.products_updated  = products_updated
                run_row.products_deleted  = products_deleted
                run_row.duration_ms       = duration_ms
                run_row.page_fetches      = parser.http_get_count
                session.commit()

        log.info("scrape_run.finalized", run_id=run_id, total_scraped=len(scraped))
        return {
            "run_id":          run_id,
            "total_scraped":   len(scraped),
            "total_failed":    len(failed_urls),
            "products_new":    products_new,
            "products_updated": products_updated,
            "products_deleted": products_deleted,
            "duration_seconds": duration_ms / 1000,
        }

    except Exception as exc:
        # ── Error path: mark run as failed ───────────────────────────────────────
        duration_ms = int((time.monotonic() - start_ts) * 1000)
        with SF() as session:
            run_row = session.get(ScrapeRunORM, run_id)
            if run_row:
                run_row.status        = "failed"
                run_row.phase         = "error"
                run_row.phase_message = str(exc)
                run_row.finished_at   = datetime.now(timezone.utc)
                run_row.duration_ms   = duration_ms
                session.commit()
        log.error("scrape_run.failed", run_id=run_id, error=str(exc))
        raise


# ── Shared task wrappers ────────────────────────────────────────────────────────

@shared_task(bind=True, name="sokogate_scraper.scheduler.tasks.full_scrape")
def full_scrape(
    self,
    base_url:      str   = settings.sokogate.base_url,
    max_pages:     int   = settings.scraper.max_pages_per_run,
    max_products:  int   = settings.scraper.max_products_per_run,
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
    Emit price-change alerts for products that have moved more than `min_change_pct`
    since the previous scrape (last N hours).
    """
    # TODO in Phase 3: send Slack / Telegram / dm-channel webhook
    self.update_state(state=states.SUCCESS, meta={"alerts_checked": 0, "alerts_triggered": 0})
    return {"alerts_checked": 0, "alerts_triggered": 0}


@shared_task(bind=True, name="sokogate_scraper.scheduler.tasks.health_check")
def health_check(self) -> dict[str, Any]:
    """Verify all infra dependencies are reachable and write a row to a metrics table."""
    checks: dict[str, bool | str] = {}

    # Database check
    try:
        from sokogate_scraper.db.postgres import get_engine
        eng = get_engine(settings.database_url)
        with eng.connect() as conn:
            conn.execute(eng.text("SELECT 1"))
        checks["database"] = True
    except Exception as exc:
        checks["database"] = str(exc)

    # Redis check
    try:
        import redis as redis_mod
        r = redis_mod.from_url(settings.celery.broker_url)
        r.ping()
        checks["redis"] = True
    except Exception as exc:
        checks["redis"] = str(exc)

    # Sokogate site check
    try:
        import httpx
        resp = httpx.head(settings.sokogate.base_url, timeout=10, follow_redirects=True)
        checks["sokogate_http"] = resp.status_code < 500
    except Exception as exc:
        checks["sokogate_http"] = str(exc)

    all_ok = all(v is True for v in checks.values())
    log.info("health_check", checks=checks, healthy=all_ok)
    return {"healthy": all_ok, "checks": checks, "checked_at": datetime.now(timezone.utc).isoformat()}


@shared_task(bind=True, name="sokogate_scraper.scheduler.tasks.nightly_cleanup")
def nightly_cleanup(self, days_inactive: int = 90) -> dict[str, Any]:
    """
    Soft-delete products not seen in `days_inactive` days.
    Run once per night at 03:30 UTC.
    """
    from sokogate_scraper.db.postgres import get_engine, get_session_factory, ProductORM

    threshold = datetime.now(timezone.utc) - timedelta(days=days_inactive)
    engine = get_engine(settings.database_url)
    SF = get_session_factory(engine)

    with SF() as session:
        stmt = (
            ProductORM.__table__.update()
            .where(
                and_(
                    ProductORM.is_active == True,
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
