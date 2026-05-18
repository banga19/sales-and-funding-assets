# Sokogate Sales & Funding Agent

Automated AI-powered sales, investor, funding, and partnership agent for
**Sokogate** (operated by **Ultimo Trading Company Limited**).
Reaches out to prospects, investors, trade-finance providers, and partners
via email.

## Four Autonomous Pipelines

| Pipeline          | Contact Type | Primary Goal                        | Batch Trigger               |
|-------------------|--------------|-------------------------------------|-----------------------------|
| **Sales**         | `prospect`   | Construction / retail bulk-sourcing sign-ups & pilots | `POST /api/agent/sales/trigger` |
| **Investor**      | `investor`   | Series-A equity fundraising for Sokogate | `POST /api/agent/investor/trigger` |
| **Funding**       | `funding`    | Trade-finance / working-capital for **Ultimo Trading Company Limited** | `POST /api/agent/funding/trigger` |
| **Partnership**   | `partner`    | Distribution, logistics, 3PL, supplier BD | `POST /api/agent/partnership/trigger` |

All pipelines share:
- **Claude AI** (Anthropic) for message generation and intent analysis
- **Resend** for email delivery
- **Supabase / PostgreSQL** for CRM storage
- **Anthropic** mixed with Claude AI for smart personalization

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL database (Neon / Supabase)
- Redis server
- API keys for: Anthropic Claude, Resend

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# 3. Run database migrations
npm run migrate

# 4. Start Redis (if not running)

# 5. Build TypeScript
npm run build

# 6. Start the agent (dry-run mode first)
AGENT_DRY_RUN=true npm start
```

---

## Pipeline Details

### Sales Pipeline (`prospect` type)
- Targets construction, manufacturing, retail, and government organisations in Kenya and East Africa
- Emphasises 15–20% procurement cost savings, 1–2 day delivery, no MOQ
- Prompts: `sales-initial`, `sales-followup-1`, `sales-followup-2`, `sales-final`

### Investor Pipeline (`investor` type)
- Targets equity / impact investors and growth equity funds
- Sokogate equity investment deck with USD 1.5 M Series A ask
- Prompts: `investor-initial`, `investor-followup`, `investor-meeting-request`

### Funding Pipeline (`funding` type)
- Targets trade-finance banks, DFIs, invoice factors, working-capital funds on behalf of **Ultimo Trading Company Limited**
- USD 500 K – 2 M in working-capital / trade-finance instruments
- Prompts: `funding-initial`, `funding-followup`, `funding-term-sheet`
- Digest: `GET /api/agent/funding/digest` → pipeline by stage, institution type, product pitched

### Partnership Pipeline (`partner` type)
- Targets distributors, 3PLs, retailers, suppliers across Ghana, Senegal, Nigeria
- Revenue-share / listing-fee / reseller models
- Prompts: `partner-initial`, `partner-followup`

### Product Sourcing (`sokogate.com` scraper)
- Autonomous WooCommerce scraper that crawls sokogate.com, parses high-res images + specs + prices, upserts to `scraped_products`
- Scheduled daily (env: `AUTO_SOURCE_INTERVAL_HOURS=24`)
- HTTP trigger: `POST /api/products/scrape`
- Status: `GET /api/products/scrape/status`

---

## Contact & Funding Entity Note

> **Ultimo Trading Company Limited** is the registered owner and parent company of
> **sokogate.com**. All investor, funding, trade-finance, and regulatory engagements
> are conducted under the Ultimo Trading entity. Sokogate is the operating / brand
> name of that entity's e-commerce platform.

When writing funding or investor messages:
- Lead with **Ultimo Trading Company Limited** as the legal counterparty
- Reference sokogate.com as the growth engine / operational asset
- Cite audited financial statements under the Ultimo Trading name

---

## Configuration

Feature flags (`.env`):

| Flag                          | Default | Description                                   |
|-------------------------------|---------|-----------------------------------------------|
| `ENABLE_SALES_OUTREACH`       | `true`  | Prospect batch outreach                        |
| `ENABLE_INVESTOR_OUTREACH`    | `true`  | Equity investor batch                          |
| `ENABLE_FUNDING_OUTREACH`     | `true`  | Ultimo Trading trade-finance batch              |
| `ENABLE_PARTNERSHIP_OUTREACH` | `true`  | Partnership / BD batch                         |
| `ENABLE_PRODUCT_SOURCING`     | `true`  | Autonomous sokogate.com scraping               |
| `ENABLE_FUNDING_DIGEST`       | `true`  | Funding pipeline digest JSON endpoint           |

Daily targets (`.env`):

```
DAILY_SALES_OUTREACH_TARGET=20
DAILY_INVESTOR_OUTREACH_TARGET=8
DAILY_FUNDING_OUTREACH_TARGET=10
DAILY_PARTNERSHIP_OUTREACH_TARGET=5
```

---

## Full API Reference

| Endpoint                                   | Method | Description                                |
|-------------------------------------------|--------|--------------------------------------------|
| `GET /api/health`                         | GET    | System health check                        |
| `GET /api/status`                         | GET    | Agent config + rate limits                 |
| `POST /api/agent/trigger`                 | POST   | Manual trigger (testing)                   |
| `POST /api/agent/sales/trigger`           | POST   | Run sales batch                            |
| `POST /api/agent/investor/trigger`        | POST   | Run investor batch                         |
| `POST /api/agent/funding/trigger`         | POST   | Run funding batch (Ultimo Trading Co.)     |
| `GET  /api/agent/funding/digest?days=30`  | GET    | Funding pipeline JSON digest               |
| `POST /api/agent/outreach/trigger`         | POST   | Generic outreach trigger                   |
| `POST /api/agent/followup/trigger`        | POST   | Process scheduled follow-ups               |
| `POST /api/agent/meeting/suggest/:id`     | POST   | Suggest meeting to contact                 |
| `GET  /api/agent/conversations/:id`       | GET    | Conversation + message history             |
| `POST /api/products/scrape`               | POST   | Trigger manual product scrape              |
| `GET  /api/products`                      | GET    | List scraped products (filterable)         |
| `GET  /api/products/scrape/status`        | GET    | Live scrape progress                       |
| `POST /api/webhooks/whatsapp`             | POST   | WhatsApp incoming webhook                  |
| `POST /api/webhooks/email`                | POST   | Email reply webhook                        |
| `POST /api/webhooks/calendly`             | POST   | Calendly booking webhook                   |

---

## Monitoring

- Health check: `curl http://localhost:3000/api/health`
- Metrics: `GET /api/agent/metrics`
- Funding digest: `GET /api/agent/funding/digest`
- Product scrape status: `GET /api/products/scrape/status`

---

Full configuration reference: [`../AGENT-CONFIGURATION.md`](./AGENT-CONFIGURATION.md)


```
agent/
├── src/
│   ├── agents/          # Core agent logic (orchestrator, personalization, etc.)
│   ├── channels/        # Communication services (email, WhatsApp, CRM)
│   ├── workflows/       # Workflow engines (outreach, follow-up, meetings)
│   ├── jobs/            # Background jobs (daily outreach, metrics sync)
│   ├── api/             # API routes and webhooks
│   ├── database/        # Database migrations and queries
│   ├── utils/           # Utility functions (logger, helpers)
│   ├── types/           # TypeScript type definitions
│   └── config/          # Configuration files
├── prompts/             # Claude AI prompts for message generation
├── tests/               # Unit, integration, and E2E tests
├── package.json
├── tsconfig.json
└── .env.example
```

## 🎯 Features

- ✅ **Intelligent Personalization**: Claude AI generates contextual messages
- ✅ **Multi-Channel Outreach**: Email (Resend) + WhatsApp Business API
- ✅ **Automated Follow-Ups**: Smart scheduling (Day 5, 12, 19)
- ✅ **Meeting Scheduling**: Calendly integration
- ✅ **CRM Integration**: Real-time sync with Sokogate AI Dashboard
- ✅ **Sentiment Analysis**: Detects positive/negative responses
- ✅ **Objection Handling**: AI-powered response generation
- ✅ **Human Escalation**: Flags complex situations for review
- ✅ **Metrics Tracking**: Real-time performance monitoring

## 🔧 Configuration

All configuration is done via environment variables in `.env`:

### Required Variables

```bash
# AI
NVIDIA_API_KEY=nvapi-xxx

# Email
RESEND_API_KEY=re_xxx
RESEND_FROM_EMAIL=sales@sokogate.com

# WhatsApp
WHATSAPP_ACCESS_TOKEN=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx

# Database
DATABASE_URL=postgresql://user:pass@host:5432/sokogate

# Redis
REDIS_URL=redis://localhost:6379
```

See `.env.example` for all available options.

## 📊 Usage

### Start the Agent

```bash
npm run dev
```

The agent will:
1. Connect to database and Redis
2. Start background job queue
3. Begin daily outreach at 09:00 EAT
4. Check for follow-ups every 6 hours
5. Sync metrics every hour

### API Endpoints

- `GET /api/health` - Health check
- `GET /api/metrics` - Current metrics
- `POST /api/agent/trigger` - Manual trigger (testing)
- `POST /api/webhooks/whatsapp` - WhatsApp incoming messages
- `POST /api/webhooks/email` - Email replies
- `POST /api/webhooks/calendly` - Meeting booked

### Manual Operations

```bash
# Generate weekly report
npm run report:weekly

# Run specific migration
npm run migrate

# Run tests
npm test
npm run test:coverage
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## 📈 Monitoring

### Logs

Logs are written to:
- Console (development)
- `logs/agent.log` (production)
- Sentry (errors only)

### Metrics

View metrics at:
- API: `GET /api/metrics`
- Dashboard: https://sokogate-ai.ultimotradingltd.co.ke/dashboard
- CSV: `../METRICS-DASHBOARD.csv`

### Health Checks

```bash
curl http://localhost:3001/api/health
```

## 🚨 Troubleshooting

### Agent Not Sending Messages

1. Check API keys in `.env`
2. Verify rate limits: `redis-cli GET "rate_limit:email:$(date +%Y%m%d)"`
3. Check logs: `pm2 logs sales-agent`
4. Test API connectivity: See SALES-AGENT-IMPLEMENTATION-PLAN.md

### Database Connection Issues

1. Verify `DATABASE_URL` is correct
2. Test connection: `psql $DATABASE_URL -c "SELECT 1"`
3. Run migrations: `npm run migrate`

### Redis Connection Issues

1. Check Redis is running: `redis-cli PING`
2. Verify `REDIS_URL` in `.env`
3. Restart Redis: `sudo systemctl restart redis`

## 📚 Documentation

- [Implementation Plan](../SALES-AGENT-IMPLEMENTATION-PLAN.md) - Complete technical documentation
- [Execution Plan](../EXECUTION-PLAN.md) - 30-day action plan
- [CRM Usage Guide](../CRM-USAGE-GUIDE.md) - Dashboard integration

## 🔐 Security

- All API keys stored in `.env` (never commit)
- Database credentials encrypted
- HTTPS required for webhooks
- Rate limiting enabled
- Input validation on all endpoints

## 📝 License

MIT

## 🤝 Support

For issues or questions:
1. Check [Troubleshooting Guide](../SALES-AGENT-IMPLEMENTATION-PLAN.md#troubleshooting-guide)
2. Review logs: `pm2 logs sales-agent`
3. Contact: founder@sokogate.com

---

**Status**: Phase 1 - Foundation Setup Complete ✅  
**Next**: Install dependencies and start building core services  
**Version**: 1.0.0  
**Last Updated**: May 15, 2026

# Made with Bob
