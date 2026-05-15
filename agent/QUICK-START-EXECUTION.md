# Quick Start - Begin Outreach Immediately

This guide will help you start reaching out to prospects, investors, and partners within minutes.

## Prerequisites Checklist

Before starting outreach, ensure you have:
- ✅ Node.js 18+ installed
- ✅ PostgreSQL 14+ running
- ✅ Redis 6+ running
- ✅ Anthropic API key (Claude)
- ✅ Resend API key (Email)
- ✅ Contact data ready (CSV or database)

## Step 1: Install & Configure (5 minutes)

```bash
# Navigate to agent directory
cd agent

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

Edit `.env` with your API keys:
```bash
# Required for immediate start
AGENT_ENABLED=true
AGENT_DRY_RUN=false  # Set to true for testing first
AGENT_PORT=3000

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/sokogate_agent

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Claude AI (Get from https://console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Email (Get from https://resend.com)
RESEND_API_KEY=re_xxxxx
RESEND_FROM_EMAIL=sales@sokogate.com
RESEND_FROM_NAME=Sokogate Sales Team

# Rate Limits (adjust as needed)
RATE_LIMIT_EMAIL_PER_DAY=50
RATE_LIMIT_WHATSAPP_PER_DAY=100
```

## Step 2: Setup Database (2 minutes)

```bash
# Create database
createdb sokogate_agent

# Run migrations
psql sokogate_agent -f src/database/migrations/004_add_agent_tables.sql

# Verify tables created
psql sokogate_agent -c "\dt"
```

You should see:
- conversations
- message_history
- scheduled_actions
- agent_metrics

## Step 3: Load Your Contacts (3 minutes)

### Option A: Load from CSV

Create a file `contacts.csv`:
```csv
name,email,phone,company,role,type,industry,location,pain_points,engagement_score
John Doe,john@example.com,+254712345678,ABC Construction,CEO,prospect,construction,Nairobi,"Supply chain delays, High costs",75
Jane Smith,jane@investor.com,,XYZ Ventures,Partner,investor,venture capital,Nairobi,"Series A opportunities",80
```

Load contacts:
```bash
psql sokogate_agent -c "
COPY contacts (name, email, phone, company, role, type, industry, location, pain_points, engagement_score)
FROM '/path/to/contacts.csv'
DELIMITER ','
CSV HEADER;
"
```

### Option B: Load from existing database

If you have contacts in the Sokogate AI Dashboard:
```bash
# Export from existing database
psql existing_db -c "
SELECT 
  name, email, phone, company, role, 
  'prospect' as type, industry, location,
  pain_points, engagement_score
FROM your_contacts_table
WHERE status = 'active'
" > contacts.csv

# Import to agent database
psql sokogate_agent -c "
COPY contacts (name, email, phone, company, role, type, industry, location, pain_points, engagement_score)
FROM '/path/to/contacts.csv'
DELIMITER ','
CSV HEADER;
"
```

### Option C: Manual SQL Insert

```sql
INSERT INTO contacts (
  name, email, phone, company, role, type, 
  industry, location, pain_points, engagement_score,
  preferred_channel, status
) VALUES 
  ('John Doe', 'john@example.com', '+254712345678', 
   'ABC Construction', 'CEO', 'prospect',
   'construction', 'Nairobi', 'Supply chain delays, High costs', 75,
   'email', 'active'),
  ('Jane Smith', 'jane@investor.com', NULL,
   'XYZ Ventures', 'Partner', 'investor',
   'venture capital', 'Nairobi', 'Series A opportunities', 80,
   'email', 'active');
```

## Step 4: Test with Dry Run (2 minutes)

Before sending real messages, test with dry run mode:

```bash
# Set dry run in .env
AGENT_DRY_RUN=true

# Build and start
npm run build
npm run dev
```

In another terminal, trigger a test outreach:
```bash
# Trigger manual outreach
curl -X POST http://localhost:3000/api/agent/outreach/trigger

# Check logs
tail -f logs/combined.log
```

You should see:
- Contacts being processed
- Messages being generated
- "DRY RUN" indicators (no actual sending)

## Step 5: Start Real Outreach (1 minute)

Once you're satisfied with dry run:

```bash
# Disable dry run in .env
AGENT_DRY_RUN=false

# Restart agent
npm run dev
```

### Manual Trigger (Immediate)
```bash
# Start outreach immediately
curl -X POST http://localhost:3000/api/agent/outreach/trigger
```

### Automatic Schedule (Daily at 9 AM EAT)
The agent will automatically process contacts daily at 9 AM EAT. No action needed.

## Step 6: Monitor Progress

### Check Agent Status
```bash
curl http://localhost:3000/api/agent/status
```

### View Outreach Statistics
```bash
curl http://localhost:3000/api/agent/outreach/stats
```

### View Sent Messages
```bash
psql sokogate_agent -c "
SELECT 
  c.name, c.email, mh.channel, mh.sent_at,
  LEFT(mh.content, 100) as message_preview
FROM message_history mh
JOIN contacts c ON mh.contact_id = c.id
WHERE mh.direction = 'outbound'
ORDER BY mh.sent_at DESC
LIMIT 10;
"
```

### View Conversations
```bash
psql sokogate_agent -c "
SELECT 
  c.name, c.company, conv.stage, 
  conv.message_count, conv.last_message_at
FROM conversations conv
JOIN contacts c ON conv.contact_id = c.id
ORDER BY conv.last_message_at DESC
LIMIT 10;
"
```

## Step 7: Handle Incoming Responses

### Email Responses
Configure Resend webhook:
1. Go to https://resend.com/webhooks
2. Add webhook URL: `https://your-domain.com/api/webhooks/email`
3. Select events: delivered, bounced, complained, opened, clicked

### WhatsApp Responses (if enabled)
Configure WhatsApp webhook:
1. Go to Facebook Developer Console
2. Add webhook URL: `https://your-domain.com/api/webhooks/whatsapp`
3. Verify token: (set in .env as WHATSAPP_WEBHOOK_VERIFY_TOKEN)

## Common Operations

### Pause Outreach for a Contact
```bash
curl -X POST http://localhost:3000/api/agent/outreach/pause/CONTACT_ID \
  -H "Content-Type: application/json" \
  -d '{"reason": "Customer requested pause"}'
```

### Resume Outreach
```bash
curl -X POST http://localhost:3000/api/agent/outreach/resume/CONTACT_ID
```

### Suggest Meeting
```bash
curl -X POST http://localhost:3000/api/agent/meeting/suggest/CONTACT_ID
```

### View Scheduled Actions
```bash
curl http://localhost:3000/api/agent/scheduled-actions?status=pending
```

### Get Metrics
```bash
# Last 30 days
curl http://localhost:3000/api/agent/metrics/summary?days=30

# Specific date range
curl "http://localhost:3000/api/agent/metrics?start=2026-05-01&end=2026-05-15"
```

## Troubleshooting

### No Messages Being Sent

1. **Check agent is enabled**:
   ```bash
   curl http://localhost:3000/api/agent/status
   ```

2. **Check rate limits**:
   ```bash
   curl http://localhost:3000/api/agent/status | grep remaining
   ```

3. **Check contacts are active**:
   ```sql
   SELECT COUNT(*) FROM contacts WHERE status = 'active' AND do_not_contact = false;
   ```

4. **Check logs**:
   ```bash
   tail -f logs/combined.log | grep ERROR
   ```

### Messages Not Personalizing

1. **Check Claude API key**:
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Check contact data**:
   ```sql
   SELECT name, company, pain_points FROM contacts LIMIT 5;
   ```

### Rate Limit Reached

1. **Check current usage**:
   ```bash
   curl http://localhost:3000/api/agent/status
   ```

2. **Increase limits in .env**:
   ```bash
   RATE_LIMIT_EMAIL_PER_DAY=100
   ```

3. **Wait for midnight reset** (automatic)

## Production Deployment

For production deployment with higher throughput:

1. **Deploy to cloud** (see DEPLOYMENT-GUIDE.md)
2. **Use managed services**:
   - AWS RDS for PostgreSQL
   - AWS ElastiCache for Redis
   - AWS ECS for containers

3. **Scale workers**:
   - Multiple agent instances
   - Load balancer
   - Shared database and Redis

4. **Monitor**:
   - Set up Sentry for errors
   - CloudWatch/Stackdriver for logs
   - Grafana for metrics

## Sample Workflow

Here's what happens automatically:

1. **9 AM EAT Daily**: Agent processes new contacts
2. **Personalized messages** generated using Claude AI
3. **Messages sent** via email or WhatsApp
4. **Responses tracked** via webhooks
5. **Intent analyzed** (positive, question, objection, etc.)
6. **Automatic follow-ups** scheduled (2-7 days)
7. **Meetings suggested** for interested leads
8. **Escalation** to human for complex cases
9. **Metrics tracked** daily

## Next Steps

1. ✅ Load your contacts
2. ✅ Test with dry run
3. ✅ Start real outreach
4. ✅ Monitor responses
5. ✅ Review metrics daily
6. ✅ Optimize based on performance

## Support

- **Logs**: `tail -f logs/combined.log`
- **Health**: `curl http://localhost:3000/api/health`
- **Documentation**: See SETUP-GUIDE.md and DEPLOYMENT-GUIDE.md

---

**You're now ready to start automated outreach!** 🚀

The agent will handle:
- ✅ Personalized message generation
- ✅ Multi-channel sending
- ✅ Response handling
- ✅ Follow-up scheduling
- ✅ Meeting coordination
- ✅ Performance tracking

Just load your contacts and let the agent do the work!

# Made with Bob
