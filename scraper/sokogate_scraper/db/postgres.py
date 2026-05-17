"""
PostgreSQL connection pool and SQLAlchemy ORM models for the scraper subsystem.

Tables
──────
products          — canonical product catalogue
price_history     — time-series of every price change
scrape_runs       — audit log of full-catalogue scrape executions
scrape_errors     — per-failure detail for debugging + alerting
proxy_log         — proxy pool health tracking
"""

from __future__ import annotations

import contextlib
from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, NUMERIC, UUID, ARRAY as PG_ARRAY
from sqlalchemy.engine import Engine, create_engine
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
)
from uuid import uuid4

from ..config import settings


# ── Base ───────────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    """Declarative base for all ORM models (see Pydantic `scrape_id` → SQLAlchemy)."""


# ── ORM models ─────────────────────────────────────────────────────────────────

class ProductORM(Base):
    __tablename__  = "scraped_products"
    __table_args__ = (
        Index("idx_scraped_products_category",      "category"),
        Index("idx_scraped_products_in_stock",      "in_stock"),
        Index("idx_scraped_products_last_scraped",  "last_scraped_at"),
        Index("idx_scraped_products_is_active",     "is_active"),
        Index("idx_scraped_products_name_gin",      "name", postgresql_using="gin",
              postgresql_ops={"name": "gin_trgm_ops"}),
        Index("idx_scraped_products_tags_gin",      "tags", postgresql_using="gin"),
    )

    id:             Mapped[str] = mapped_column(UUID, primary_key=True, default=uuid4)
    source_url:     Mapped[str] = mapped_column(Text, unique=True, nullable=False, index=True)
    name:           Mapped[str] = mapped_column(Text, nullable=False)
    description:    Mapped[str | None] = mapped_column(Text, nullable=True)
    category:       Mapped[str] = mapped_column(Text, nullable=False, default="General", index=True)
    sku:            Mapped[str | None] = mapped_column(Text, nullable=True)
    price_current:  Mapped[float | None] = mapped_column(NUMERIC(12, 2), nullable=True)
    price_raw:      Mapped[str | None] = mapped_column(Text, nullable=True)
    currency:       Mapped[str] = mapped_column(Text, nullable=False, default="KES")
    in_stock:       Mapped[bool] = mapped_column(nullable=False, default=True, index=True)
    images:         Mapped[list[str]] = mapped_column(PG_ARRAY(Text), nullable=False, default=list)
    specifications: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict)
    attributes:     Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict)
    variations:     Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    tags:           Mapped[list[str]] = mapped_column(PG_ARRAY(Text), nullable=False, default=list)
    last_scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    first_seen_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                                                      onupdate=lambda: datetime.now(timezone.utc))
    is_active:      Mapped[bool] = mapped_column(nullable=False, default=True, index=True)

    # Relationships
    price_history: Mapped[list["PriceHistoryORM"]] = relationship(
        "PriceHistoryORM", back_populates="product", cascade="all, delete-orphan"
    )


class PriceHistoryORM(Base):
    __tablename__  = "price_history"

    id:             Mapped[str] = mapped_column(UUID, primary_key=True, default=uuid4)
    product_id:     Mapped[str] = mapped_column(UUID, ForeignKey("scraped_products.id", ondelete="CASCADE"), index=True, nullable=False)
    price:          Mapped[float] = mapped_column(NUMERIC(12, 2), nullable=False)
    currency:       Mapped[str] = mapped_column(Text, nullable=False, default="KES")
    in_stock:       Mapped[bool] = mapped_column(nullable=False)
    scrape_run_id:  Mapped[str | None] = mapped_column(UUID, index=True, nullable=True)
    raw_price:      Mapped[str | None] = mapped_column(Text, nullable=True)
    notes:          Mapped[str | None] = mapped_column(Text, nullable=True)
    observed_at:    Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    product:        Mapped[ProductORM] = relationship("ProductORM", back_populates="price_history")


class ScrapeRunORM(Base):
    __tablename__  = "scrape_runs"
    __table_args__ = (
        Index("idx_scrape_runs_started", "started_at"),
        Index("idx_scrape_runs_status",  "status"),
        Index("idx_scrape_runs_phase",   "phase"),
    )

    id:               Mapped[str] = mapped_column(UUID, primary_key=True, default=uuid4)
    started_at:       Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    finished_at:      Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    base_url:         Mapped[str] = mapped_column(Text, default="https://sokogate.com")
    products_found:   Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    products_scraped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    products_failed:  Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    products_new:     Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    products_updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    products_deleted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status:           Mapped[str] = mapped_column(Text, nullable=False, default="running")  # running|completed|failed|cancelled
    phase:            Mapped[str] = mapped_column(Text, nullable=False, default="discovering")
    phase_message:    Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message:    Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent:       Mapped[str | None] = mapped_column(Text, nullable=True)
    proxy_used:       Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms:      Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_fetches:     Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metadata:         Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class ScrapeErrorORM(Base):
    __tablename__  = "scrape_errors"
    __table_args__ = (
        Index("idx_scrape_errors_run",      "scrape_run_id"),
        Index("idx_scrape_errors_type",     "error_type"),
        Index("idx_scrape_errors_occurred", "occurred_at"),
    )

    id:           Mapped[str] = mapped_column(UUID, primary_key=True, default=uuid4)
    scrape_run_id: Mapped[str | None] = mapped_column(UUID, ForeignKey("scrape_runs.id", ondelete="CASCADE"), index=True, nullable=True)
    product_url:  Mapped[str] = mapped_column(Text, nullable=False)
    error_type:   Mapped[str] = mapped_column(Text, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    http_status:  Mapped[int | None] = mapped_column(Integer, nullable=True)
    stack_trace:  Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class ProxyLogORM(Base):
    __tablename__  = "proxy_log"
    __table_args__ = (
        UniqueConstraint("proxy_url", name="uq_proxy_log_url"),
        Index("idx_proxy_log_active", "is_active"),
    )

    id:              Mapped[str] = mapped_column(UUID, primary_key=True, default=uuid4)
    proxy_url:       Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    requests_used:   Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    requests_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_used_at:    Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    banned_at:       Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active:       Mapped[bool] = mapped_column(nullable=False, default=True)
    added_at:        Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    notes:           Mapped[str | None] = mapped_column(Text, nullable=True)


# ── Engine + session factory ────────────────────────────────────────────────────

def get_engine(url: str) -> Engine:
    """Return a SQLAlchemy Engine from a full `postgresql+psycopg://…` URL."""
    return create_engine(
        url,
        pool_size      = settings.postgres_pool_size,
        max_overflow   = settings.postgres_max_overflow,
        pool_pre_ping  = True,          # stale connection guard
        pool_recycle   = 1_800,         # recycle connections after 30 min
        echo           = settings.environment == "development",
        future         = True,
    )


def get_session_factory(engine: Engine) -> type[Session]:
    """Return a session factory bound to the given engine."""
    from sqlalchemy.orm import sessionmaker
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


@contextlib.contextmanager
def session_scope(engine: Engine) -> Iterator[Session]:
    """Context manager — commit on success, rollback on exception."""
    session_factory = get_session_factory(engine)
    session: Session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Alembic migration support ──────────────────────────────────────────────────
# The `env.py` file generated by `alembic init` should import all ORM models above
# so that `alembic revision --autogenerate` picks up every change to the schema.


__all__ = [
    "Base",
    "ProductORM",
    "PriceHistoryORM",
    "ScrapeRunORM",
    "ScrapeErrorORM",
    "ProxyLogORM",
    "get_engine",
    "get_session_factory",
    "session_scope",
]
