# Sokogate Sales & Funding Agent

Automated AI-powered sales and funding agent that reaches out to prospects, investors, and partners via WhatsApp and email.

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ 
- PostgreSQL database (Neon)
- Redis server
- API keys for: Anthropic Claude, Resend, WhatsApp Business, Calendly

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
# Windows: redis-server
# Or use Docker: docker run -d -p 6379:6379 redis:alpine

# 5. Build TypeScript
npm run build

# 6. Start the agent
npm run dev  # Development
npm start    # Production
```

## 📁 Project Structure

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
ANTHROPIC_API_KEY=sk-ant-xxx

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
