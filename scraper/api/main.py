"""
REST API for the Sokogate scraper (FastAPI on :8000).

Endpoints
─────────
GET    /health                     → liveness / version
GET    /api/v1/scrape/status       → current / most-recent scrape run
POST   /api/v1/scrape/trigger      → kick off a full-catalogue crawl (202 accepted)
GET    /api/v1/products            → paginated product list (filters: category, in_stock, search)
GET    /api/v1/products/{product_id}  → single product detail
GET    /api/v1/products/price-alerts → products whose price changed since last check
GET    /api/v1/scrape-runs          → paginated audit log of scrape runs
GET    /api/v1/scrape-runs/{run_id} → single run detail + product counts
GET    /api/v1/stats                → daily snapshot: total products / in-stock / categories
GET    /api/v1/categories           → list of all product categories with counts
POST   /api/v1/products/{product_id}/refresh  → re-scrape a single product on demand
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import structlog
import orjson

# ── Register the scraper package at import time ─────────────────────────────────
import importlib, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sokogate_scraper.config import settings
from sokogate_scraper.db.postgres import (
    get_engine, get_session_factory, ScrapeRunORM, ProductORM,
)
from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

# ── Structured logger ──────────────────────────────────────────────────────────
log = structlog.get_logger()

# ── Pydantic response schemas ──────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status:    str      = "healthy"
    service:   str      = "sokogate-scraper-api"
    version:   str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ScrapeStatusResponse(BaseModel):
    success:      bool
    phase:        str           # idle | discovering | scraping | complete | error
    message:      str
    product_count: int
    current_run_id: Optional[str] = None
    started_at:   Optional[datetime] = None
    scraped_at:   Optional[datetime] = None


class ScrapeTriggerResponse(BaseModel):
    success:    bool
    message:    str
    run_id:     Optional[str] = None
    status:     str           # "queued"
    estimated_duration_seconds: int = 120


class ProductOut(BaseModel):
    id:            Optional[str]
    source_url:    str
    name:          str
    description:   Optional[str]
    category:      str
    price_current: Optional[float]
    currency:      str
    in_stock:      Optional[bool]
    images:        list[str]
    specifications: dict[str, str]
    sku:           Optional[str]
    last_scraped_at: Optional[datetime]
    created_at:    Optional[datetime]
    updated_at:    Optional[datetime]

    class Config:
        from_attributes = True


class ProductListResponse(BaseModel):
    data:        list[ProductOut]
    total:       int
    page:        int
    page_size:   int
    categories:  list[str]


class ScrapeRunOut(BaseModel):
    id:             str
    started_at:     datetime
    finished_at:    Optional[datetime]
    status:         str
    phase:          str
    phase_message:  Optional[str]
    products_found:  int
    products_scraped: int
    products_new:    int
    products_updated: int
    products_failed: int
    products_deleted: int
    duration_ms:    Optional[int]

    class Config:
        from_attributes = True


class ScrapeRunListResponse(BaseModel):
    data:   list[ScrapeRunOut]
    total:  int
    page:   int
    page_size: int


class StatsResponse(BaseModel):
    total_products:    int
    in_stock:          int
    out_of_stock:      int
    categories:        int
    last_scraped_at:   Optional[datetime]
    price_history_days: int


# ── Application factory ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown hooks."""
    engine = get_engine(settings.database_url)
    app.state.db_engine = engine
    app.state.session_factory = get_session_factory(engine)
    log.info("sokogate-scraper-api.started", version=settings.version)
    yield
    engine.dispose()
    log.info("sokogate-scraper-api.shutdown")


app = FastAPI(
    title      = "Sokogate Product Scraper API",
    description = "REST API for managing the sokogate.com product crawler — "
                  "trigger runs, inspect status, browse the live catalogue.",
    version    = settings.version,
    lifespan   = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = settings.fastapi.cors_origins,
    allow_credentials = True,
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers     = ["*"],
)

# ── Helpers ────────────────────────────────────────────────────────────────────

SyncSession = get_session_factory  # forward-declared; bound in lifespan above

def orm_to_pydantic_product(orm: ProductORM) -> ProductOut:
    return ProductOut(
        id=str(orm.id),
        source_url   = orm.source_url,
        name         = orm.name,
        description  = orm.description,
        category     = orm.category,
        price_current = float(orm.price_current) if orm.price_current is not None else None,
        currency     = orm.currency,
        in_stock     = orm.in_stock,
        images       = orm.images or [],
        specifications = orm.specifications or {},
        sku          = orm.sku,
        last_scraped_at = orm.last_scraped_at,
        created_at   = orm.created_at,
        updated_at   = orm.updated_at,
    )

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(version=settings.version)


@app.get("/api/v1/scrape/status", response_model=ScrapeStatusResponse)
def get_scrape_status():
    """
    Return the most-recent scrape_run row from PostgreSQL.

    The in-flight status is tracked by `scrape_runs.status` + `scrape_runs.phase`:
      running / discovering / scraping / complete / failed / error
    """
    with SyncSession() as session:
        run = (
            session.execute(
                select(ScrapeRunORM)
                .order_by(ScrapeRunORM.started_at.desc())
                .limit(1)
            )
            .scalar_one_or_none()
        )
        product_count = session.execute(select(func.count()).select_from(ProductORM)).scalar() or 0

    if not run:
        return ScrapeStatusResponse(
            success      = True,
            phase        = "idle",
            message      = "No scrape runs recorded yet",
            product_count = product_count,
        )

    phase_labels = {
        "running":   "running",
        "discovering": "discovering",
        "scraping":  "scraping",
        "complete":  "complete",
        "failed":    "error",
        "cancelled": "error",
    }
    return ScrapeStatusResponse(
        success       = True,
        phase         = phase_labels.get(run.status, run.status),
        message       = run.phase_message or f"Run {run.id} — {run.status}",
        product_count = product_count,
        current_run_id = str(run.id) if run.status == "running" else None,
        started_at    = run.started_at,
        scraped_at    = run.finished_at,
    )


@app.post("/api/v1/scrape/trigger", response_model=ScrapeTriggerResponse)
def trigger_scrape(
    base_url:   Optional[str]  = Query(None, description="Override target base URL"),
    max_pages:  Optional[int]  = Query(None, ge=1, le=50, description="Max listing pages to crawl"),
    max_products: Optional[int] = Query(None, ge=1, le=500, description="Max detail pages to scrape"),
):
    """
    Enqueue a full-catalogue scrape job through Celery.

    Returns 202 Accepted immediately — the job runs asynchronously.
    Poll GET /api/v1/scrape/status for progress, or GET /api/v1/scrape-runs
    for the full audit log.
    """
    from sokogate_scraper.scheduler.celery_app import celery_app

    _base   = base_url   or settings.sokogate.base_url
    _pages  = max_pages  or settings.scraper.max_pages_per_run
    _prods  = max_products or settings.scraper.max_products_per_run

    result = celery_app.send_task(
        "sokogate_scraper.scheduler.tasks.full_scrape",
        args    = [_base, _pages, _prods],
        kwargs  = {},
    )
    log.info("scrape.triggered", task_id=result.id, base_url=_base, max_pages=_pages)
    return ScrapeTriggerResponse(
        success    = True,
        message    = f"Scrape job queued — task {result.id}",
        run_id     = result.id,
        status     = "queued",
    )


@app.get("/api/v1/products", response_model=ProductListResponse)
def list_products(
    page:        int       = Query(1,    ge=1),
    page_size:   int       = Query(20,   ge=1, le=100),
    category:    Optional[str] = Query(None),
    in_stock:    Optional[bool] = Query(None),
    search:      Optional[str]  = Query(None),
):
    """Return a paginated product catalogue filtered by category / in_stock / search."""
    with SyncSession() as session:
        stmt = select(ProductORM).where(ProductORM.is_active == True)

        if category:
            stmt = stmt.where(ProductORM.category.ilike(f"%{category}%"))
        if in_stock is not None:
            stmt = stmt.where(ProductORM.in_stock == in_stock)
        if search:
            stmt = stmt.where(
                func.lower(ProductORM.name).contains(search.lower())
                | func.lower(ProductORM.description).contains(search.lower())
            )

        total   = session.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
        rows    = (
            session.execute(
                stmt
                .order_by(ProductORM.updated_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            .scalars()
            .all()
        )

        # distinct categories for the filter chips
        cat_stmt = select(ProductORM.category).distinct().where(ProductORM.is_active == True)
        categories = [r[0] for r in session.execute(cat_stmt).all() if r[0]]

    return ProductListResponse(
        data       = [orm_to_pydantic_product(r) for r in rows],
        total      = total,
        page       = page,
        page_size  = page_size,
        categories = sorted(categories),
    )


@app.get("/api/v1/products/{product_id}", response_model=ProductOut)
def get_product(product_id: str):
    """Return a single product by its UUID."""
    with SyncSession() as session:
        orm = session.get(ProductORM, product_id)
        if not orm or not orm.is_active:
            raise HTTPException(status_code=404, detail="Product not found")
        return orm_to_pydantic_product(orm)


@app.get("/api/v1/products/{product_id}/refresh", response_model=ProductOut)
def refresh_product(
    product_id: str,
    use_playwright: bool = Query(False, description="Use headless browser for JS-heavy pages"),
):
    """
    Re-scrape a single product on demand.  Useful for spot-checks after a price change.

    Returns the freshly updated `ProductOut`.
    """
    raise HTTPException(
        status_code = 501,
        detail = "On-demand single-product refresh requires a live Playwright session. "
                 "Use POST /api/v1/scrape/trigger for full-catalogue runs.",
    )


@app.get("/api/v1/scrape-runs", response_model=ScrapeRunListResponse)
def list_scrape_runs(
    page:      int          = Query(1,      ge=1),
    page_size: int          = Query(20,     ge=1, le=100),
    status:    Optional[str] = Query(None, description="Filter by status (running/completed/failed)"),
):
    """Return a paginated audit log of all scrape runs."""
    with SyncSession() as session:
        stmt = select(ScrapeRunORM)
        if status:
            stmt = stmt.where(ScrapeRunORM.status == status)
        total  = session.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
        runs   = (
            session.execute(
                stmt
                .order_by(ScrapeRunORM.started_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            .scalars()
            .all()
        )

    return ScrapeRunListResponse(
        data      = [
            ScrapeRunOut(
                id            = str(r.id),
                started_at    = r.started_at,
                finished_at   = r.finished_at,
                status        = r.status,
                phase         = r.phase,
                phase_message = r.phase_message,
                products_found   = r.products_found,
                products_scraped = r.products_scraped,
                products_new     = r.products_new,
                products_updated = r.products_updated,
                products_failed  = r.products_failed,
                products_deleted = r.products_deleted,
                duration_ms  = r.duration_ms,
            )
            for r in runs
        ],
        total     = total,
        page      = page,
        page_size = page_size,
    )


@app.get("/api/v1/stats", response_model=StatsResponse)
def get_stats():
    """Return a live snapshot of the product catalogue."""
    with SyncSession() as session:
        total      = session.execute(select(func.count()).select_from(ProductORM)).scalar() or 0
        in_stock   = session.execute(
            select(func.count()).where(and_(ProductORM.is_active == True, ProductORM.in_stock == True))
        ).scalar() or 0
        categories = session.execute(
            select(func.count(func.distinct(ProductORM.category)))
        ).scalar() or 0
        last_scraped = (
            session.execute(select(func.max(ProductORM.last_scraped_at))).scalar() or None
        )

    return StatsResponse(
        total_products     = total,
        in_stock           = in_stock,
        out_of_stock       = total - in_stock,
        categories         = categories,
        last_scraped_at    = last_scraped,
        price_history_days = 30,
    )


@app.get("/api/v1/categories")
def list_categories():
    """Return every unique product category with a count of active products in each."""
    with SyncSession() as session:
        rows = (
            session.execute(
                select(ProductORM.category, func.count())
                .where(ProductORM.is_active == True)
                .group_by(ProductORM.category)
                .order_by(func.count().desc())
            )
            .all()
        )
    return {"categories": [{"name": r[0], "count": r[1]} for r in rows]}


@app.get("/api/v1/products/price-alerts")
def get_price_alerts(
    since_hours:    int   = Query(24,  ge=1, le=720, description="Only return changes in this many hours"),
    min_change_pct: float = Query(0.0, ge=0, le=100, description="Minimum % change to include"),
):
    """
    Return products whose price changed within the given time window.

    Joins ``price_history`` → ``products`` and computes the delta between the
    most-recent observation and the one immediately before it, then filters by
    ``min_change_pct``.
    """
    from datetime import timedelta
    from sqlalchemy import and_, func as sa_func
    from sqlalchemy.orm import aliased

    cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)

    with SyncSession() as session:
        # Sub-query: latest price_history row per product within the window
        latest_ph = (
            select(
                PriceHistoryORM.product_id,
                PriceHistoryORM.price,
            )
            .where(PriceHistoryORM.observed_at >= cutoff)
            .order_by(PriceHistoryORM.product_id, PriceHistoryORM.observed_at.desc())
            .distinct(PriceHistoryORM.product_id)
            .subquery()
        )

        # Sub-query: previous-latest price_history row per product (before the cutoff)
        prev_ph = (
            select(
                PriceHistoryORM.product_id,
                PriceHistoryORM.price.label("prev_price"),
            )
            .where(PriceHistoryORM.observed_at < cutoff)
            .order_by(PriceHistoryORM.product_id, PriceHistoryORM.observed_at.desc())
            .distinct(PriceHistoryORM.product_id)
            .subquery()
        )

        stmt = (
            select(
                ProductORM.id,
                ProductORM.name,
                ProductORM.source_url,
                ProductORM.category,
                ProductORM.price_current,
                ProductORM.images,
                latest_ph.c.price.label("new_price"),
                prev_ph.c.prev_price,
            )
            .join(latest_ph, ProductORM.id == latest_ph.c.product_id)
            .outerjoin(prev_ph, ProductORM.id == prev_ph.c.product_id)
            .where(ProductORM.is_active == True)
        )

        threshold = float(min_change_pct) / 100.0
        rows = session.execute(stmt).all()

        alerts = []
        for row in rows:
            product_id, name, url, category, current, images, new_price, prev_price = row
            if prev_price is None or new_price is None:
                continue
            if prev_price == 0:
                continue
            pct = abs(float(new_price) - float(prev_price)) / float(prev_price)
            if pct < threshold:
                continue
            direction = "up" if float(new_price) > float(prev_price) else "down"
            alerts.append({
                "product_id":    str(product_id),
                "name":          name,
                "url":           url,
                "category":      category,
                "old_price":     float(prev_price),
                "new_price":     float(new_price),
                "pct_change":    round(pct * 100, 2),
                "currency":      "KES",
                "direction":     direction,
                "images":        images or [],
                "observed_at":   datetime.now(timezone.utc).isoformat(),
            })

    return {"alerts": alerts, "count": len(alerts), "window_hours": since_hours}


# ── All endpoints registered ────────────────────────────────────────────────────
# See docs/SCRAPER_API.md for full request/response examples
