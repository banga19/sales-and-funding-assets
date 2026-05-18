# Fixing Database Connection Error

## The Error You're Seeing

```
error: Query execution failed
{
  "error": {
    "errno": -3008,
    "code": "ENOTFOUND",
    "syscall": "getaddrinfo",
    "hostname": "host"
  }
}
```

This means the agent is trying to connect to a database but can't find the host.

## Quick Fix Options

### Option 1: Use a Free Cloud Database (Recommended - 5 minutes)

**Supabase (Free)**:
1. Go to https://supabase.com
2. Click "Start your project"
3. Create a new project
4. Go to Settings → Database
5. Copy the "Connection string" (URI format)
6. Edit your `.env` file:

```bash
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

**Neon (Free)**:
1. Go to https://neon.tech
2. Sign up and create a project
3. Copy the connection string
4. Update `.env`:

```bash
DATABASE_URL=postgresql://[user]:[password]@[host].neon.tech/[dbname]?sslmode=require
```

### Option 2: Run Without Database (Testing Only)

Edit your `.env` file and change these lines:

```bash
# Disable the agent to skip database checks
AGENT_ENABLED=false

# Keep dry run mode
AGENT_DRY_RUN=true

# Disable features that need database
ENABLE_WHATSAPP=false
ENABLE_EMAIL=false
ENABLE_AUTO_FOLLOWUP=false
ENABLE_AUTO_SCHEDULING=false
```

Then the agent will start in API-only mode for testing.

### Option 3: Install PostgreSQL Locally

**Windows**:
1. Download from https://www.postgresql.org/download/windows/
2. Install with default settings
3. Remember the password you set for `postgres` user
4. Update `.env`:

```bash
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/sokogate_agent
```

5. Create the database:
```powershell
# Open PowerShell as Administrator
psql -U postgres
CREATE DATABASE sokogate_agent;
\q
```

6. Run migrations:
```powershell
cd agent
psql -U postgres -d sokogate_agent -f src/database/migrations/004_add_agent_tables.sql
```

## Redis Setup (Also Required)

The agent also needs Redis for job queues.

### Option 1: Cloud Redis (Easiest)

**Upstash (Free)**:
1. Go to https://upstash.com
2. Create a Redis database
3. Copy the connection details
4. Update `.env`:

```bash
REDIS_URL=redis://default:[password]@[host].upstash.io:6379
```

### Option 2: Docker

```powershell
docker run -d -p 6379:6379 redis
```

Then in `.env`:
```bash
REDIS_URL=redis://localhost:6379
```

### Option 3: Skip Redis (Testing Only)

Set in `.env`:
```bash
AGENT_ENABLED=false
```

## Complete Test Configuration

Here's a minimal `.env` that will let the agent start:

```bash
# AI (Required - get from https://nvidia.com)
NVIDIA_API_KEY=nvapi-your_key_here

# Email (Required - get from https://resend.com)
RESEND_API_KEY=re_your_key_here
RESEND_FROM_EMAIL=sales@sokogate.com
RESEND_FROM_NAME=Sokogate Sales Team

# Database (Use Supabase or Neon free tier)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Redis (Use Upstash free tier)
REDIS_URL=redis://localhost:6379

# Agent Settings - Start in test mode
AGENT_ENABLED=true
AGENT_DRY_RUN=true
AGENT_PORT=3000

# Features - Enable what you have configured
ENABLE_EMAIL=true
ENABLE_WHATSAPP=false
ENABLE_AUTO_FOLLOWUP=true
ENABLE_AUTO_SCHEDULING=false
```

## Verify It Works

After updating `.env`, restart the agent:

```powershell
npm start
```

You should see:
```
2026-05-15 20:43:28 info: Agent server started on port 3000
2026-05-15 20:43:28 info: Health check passed
```

Test the API:
```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/health
```

## Still Having Issues?

### Check Your .env File

```powershell
# View current configuration
Get-Content .env | Select-String "DATABASE_URL|REDIS_URL|AGENT_ENABLED"
```

### Check Logs

```powershell
# View recent logs
Get-Content logs/combined.log -Tail 50
```

### Test Database Connection

```powershell
# Test if you can reach the database
Test-NetConnection -ComputerName your-db-host.com -Port 5432
```

## Recommended Setup for Quick Start

1. **Get NVIDIA API Key**: https://nvidia.com (required)
2. **Get Resend API Key**: https://resend.com (required)
3. **Get Supabase Database**: https://supabase.com (free, 5 min setup)
4. **Get Upstash Redis**: https://upstash.com (free, 2 min setup)
5. **Update `.env`** with all the connection strings
6. **Run**: `npm start`

Total setup time: ~15 minutes

## Need Help?

Check these files:
- `WINDOWS-SETUP.md` - Complete Windows guide
- `QUICK-START-EXECUTION.md` - 15-minute setup
- `SETUP-GUIDE.md` - Detailed installation
- `BUILD-SUCCESS.md` - Build and deployment info

---

**The agent code is working perfectly** - you just need to configure the database and Redis connections in your `.env` file!

# Made with Bob
