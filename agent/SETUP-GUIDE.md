# Sales & Funding Agent - Setup Guide

Complete guide to set up and run the automated sales and funding agent for Sokogate.

## Prerequisites

- **Node.js**: v18 or higher
- **PostgreSQL**: v14 or higher
- **Redis**: v6 or higher (for job queues)
- **API Keys**:
  - Anthropic Claude API key
  - Resend API key (for email)
  - WhatsApp Business API credentials (optional)
  - Calendly API key (optional)

## Step 1: Install Dependencies

```bash
cd agent
npm install
```

This will install all required packages:
- `@anthropic-ai/sdk` - Claude AI integration
- `resend` - Email service
- `bullmq` - Job queue management
- `ioredis` - Redis client
- `winston` - Logging
- `express` - Web server
- `pg` - PostgreSQL client
- `axios` - HTTP client
- `dotenv` - Environment variables

## Step 2: Database Setup

### Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE sokogate_agent;

# Exit psql
\q
```

### Run Migrations

```bash
# Set your database URL
export DATABASE_URL="postgresql://username:password@localhost:5432/sokogate_agent"

# Run the agent tables migration
psql $DATABASE_URL -f src/database/migrations/004_add_agent_tables.sql
```

This creates 4 tables:
- `conversations` - Tracks conversation state per contact
- `message_history` - Logs all sent/received messages
- `scheduled_actions` - Queues future automated actions
- `agent_metrics` - Stores performance metrics

### Verify Tables

```bash
psql $DATABASE_URL -c "\dt"
```

You should see:
- conversations
- message_history
- scheduled_actions
- agent_metrics

## Step 3: Redis Setup

### Install Redis (if not already installed)

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis-server
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Windows:**
Download from https://redis.io/download or use WSL

### Verify Redis

```bash
redis-cli ping
# Should return: PONG
```

## Step 4: Environment Configuration

### Create .env file

```bash
cp .env.example .env
```

### Configure Required Variables

Edit `.env` and set these **required** variables:

```bash
# Agent Configuration
AGENT_ENABLED=true
AGENT_DRY_RUN=false  # Set to true for testing without sending messages
AGENT_PORT=3000

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/sokogate_agent

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Anthropic Claude AI
ANTHROPIC_API_KEY=sk-ant-xxxxx  # Get from https://console.anthropic.com

# Email (Resend)
RESEND_API_KEY=re_xxxxx  # Get from https://resend.com
RESEND_FROM_EMAIL=sales@sokogate.com
RESEND_FROM_NAME=Sokogate Sales Team

# Rate Limits
RATE_LIMIT_EMAIL_PER_DAY=50
RATE_LIMIT_WHATSAPP_PER_DAY=100
```

### Optional Variables

For full functionality, also configure:

```bash
# WhatsApp Business API (optional)
WHATSAPP_ENABLED=false
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token

# Calendly (optional)
CALENDLY_ENABLED=false
CALENDLY_API_KEY=your_calendly_api_key
CALENDLY_EVENT_TYPE_UUID=your_event_type_uuid

# Monitoring (optional)
SENTRY_DSN=your_sentry_dsn
SENTRY_ENVIRONMENT=development
```

## Step 5: Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

## Step 6: Run the Agent

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### With PM2 (recommended for production)

```bash
# Install PM2 globally
npm install -g pm2

# Start agent
pm2 start dist/index.js --name sokogate-agent

# View logs
pm2 logs sokogate-agent

# Monitor
pm2 monit

# Stop
pm2 stop sokogate-agent

# Restart
pm2 restart sokogate-agent
```

## Step 7: Verify Installation

### Check Health Endpoint

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-05-15T15:00:00.000Z",
  "checks": {
    "database": true,
    "email": true,
    "whatsapp": true,
    "claude": true
  }
}
```

### Check Agent Status

```bash
curl http://localhost:3000/api/status
```

Expected response:
```json
{
  "enabled": true,
  "dryRun": false,
  "features": {
    "email": true,
    "whatsapp": false,
    "calendly": false
  },
  "rateLimits": {
    "email": {
      "remaining": 50,
      "limit": 50
    },
    "whatsapp": null
  }
}
```

## Step 8: Test with Dry Run

Before sending real messages, test with dry run mode:

1. Set `AGENT_DRY_RUN=true` in `.env`
2. Restart the agent
3. Trigger a test outreach (see Testing section below)
4. Check logs to verify message generation without actual sending

## Testing

### Manual Trigger

```bash
curl -X POST http://localhost:3000/api/agent/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "action": "initial_outreach",
    "contact_id": "test-contact-123"
  }'
```

### View Logs

```bash
# Development
tail -f logs/combined.log

# Production with PM2
pm2 logs sokogate-agent
```

## Troubleshooting

### Database Connection Issues

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Check if tables exist
psql $DATABASE_URL -c "\dt"
```

### Redis Connection Issues

```bash
# Test Redis
redis-cli ping

# Check if Redis is running
sudo systemctl status redis-server  # Linux
brew services list  # macOS
```

### API Key Issues

```bash
# Test Anthropic API
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 10,
    "messages": [{"role": "user", "content": "Hi"}]
  }'

# Test Resend API
curl https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "onboarding@resend.dev",
    "to": "test@example.com",
    "subject": "Test",
    "html": "<p>Test</p>"
  }'
```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill process
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows

# Or change port in .env
AGENT_PORT=3001
```

### TypeScript Compilation Errors

```bash
# Clean build
rm -rf dist/
npm run build

# Check TypeScript version
npx tsc --version

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

1. **Import Contacts**: Load your prospects, investors, and partners into the database
2. **Configure Workflows**: Customize outreach sequences and follow-up timing
3. **Set Up Monitoring**: Configure Sentry for error tracking
4. **Schedule Jobs**: Set up cron jobs for daily outreach batches
5. **Integrate CRM**: Connect to Sokogate AI Dashboard for unified tracking

## Production Deployment

See `DEPLOYMENT-GUIDE.md` for:
- Cloud deployment (AWS, GCP, Azure)
- Docker containerization
- CI/CD pipeline setup
- Monitoring and alerting
- Backup and disaster recovery
- Scaling strategies

## Support

For issues or questions:
1. Check logs: `tail -f logs/combined.log`
2. Review health endpoint: `curl http://localhost:3000/api/health`
3. Verify environment variables: `node -e "require('dotenv').config(); console.log(process.env)"`
4. Consult implementation plan: `SALES-AGENT-IMPLEMENTATION-PLAN.md`

## Security Notes

- **Never commit `.env` file** - Contains sensitive API keys
- **Use environment-specific configs** - Different keys for dev/staging/prod
- **Rotate API keys regularly** - Especially after team changes
- **Monitor rate limits** - Avoid hitting API quotas
- **Enable HTTPS in production** - Use SSL/TLS certificates
- **Implement authentication** - Protect API endpoints
- **Regular backups** - Database and Redis data
- **Audit logs** - Track all agent actions

## Performance Tips

- **Use connection pooling** - Already configured in db.client.ts
- **Enable Redis persistence** - For job queue reliability
- **Monitor memory usage** - Especially with large contact lists
- **Batch operations** - Process contacts in groups
- **Cache frequently accessed data** - Reduce database queries
- **Use indexes** - Already created in migration
- **Regular maintenance** - Vacuum PostgreSQL, clear old logs

## Maintenance

### Daily
- Check agent health endpoint
- Review error logs
- Monitor rate limit usage

### Weekly
- Review conversation metrics
- Analyze escalation patterns
- Update prompt templates if needed

### Monthly
- Database maintenance (VACUUM, ANALYZE)
- Review and optimize queries
- Update dependencies
- Rotate API keys

## Resources

- [Anthropic Claude API Docs](https://docs.anthropic.com)
- [Resend API Docs](https://resend.com/docs)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
- [BullMQ Documentation](https://docs.bullmq.io)
- [PostgreSQL Documentation](https://www.postgresql.org/docs)

# Made with Bob
