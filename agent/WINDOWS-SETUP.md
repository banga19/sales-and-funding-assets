# Windows Setup Guide - Sokogate Sales & Funding Agent

Quick setup guide specifically for Windows PowerShell users.

## Prerequisites

- ✅ Windows 10 or 11
- ✅ Node.js 18+ (you have v22.15.0 ✓)
- ⚠️ PostgreSQL (optional - can use cloud database)
- ⚠️ Redis (optional - can use cloud Redis)

## Quick Start (5 Minutes)

### Option 1: Automated Setup (Recommended)

```powershell
# Run the setup script
.\setup-windows.ps1
```

This will:
1. Check Node.js version
2. Create .env file from template
3. Install dependencies
4. Build TypeScript code

### Option 2: Manual Setup

```powershell
# 1. Install dependencies
npm install

# 2. Create environment file
copy .env.example .env

# 3. Edit .env with your API keys
notepad .env

# 4. Build the project
npm run build
```

## Required Configuration

Edit `.env` file with these minimum settings:

```bash
# Agent Settings
AGENT_ENABLED=true
AGENT_DRY_RUN=true  # Set to false when ready for real messages
AGENT_PORT=3000

# API Keys (REQUIRED)
NVIDIA_API_KEY=nvapi-xxxxx  # Get from https://nvidia.com
RESEND_API_KEY=re_xxxxx         # Get from https://resend.com

# Database (Use cloud or local)
DATABASE_URL=postgresql://user:pass@localhost:5432/sokogate_agent

# Redis (Use cloud or local)
REDIS_HOST=localhost
REDIS_PORT=6379

# Email Settings
RESEND_FROM_EMAIL=sales@sokogate.com
RESEND_FROM_NAME=Sokogate Sales Team
```

## Database Options

### Option A: Use Cloud Database (Easiest)

**Supabase (Free tier available)**:
1. Go to https://supabase.com
2. Create new project
3. Get connection string
4. Use in DATABASE_URL

**Neon (Free tier available)**:
1. Go to https://neon.tech
2. Create new project
3. Get connection string
4. Use in DATABASE_URL

### Option B: Install PostgreSQL Locally

1. Download from: https://www.postgresql.org/download/windows/
2. Install with default settings
3. Remember the password you set
4. Use: `postgresql://postgres:yourpassword@localhost:5432/sokogate_agent`

## Redis Options

### Option A: Use Cloud Redis (Easiest)

**Upstash (Free tier available)**:
1. Go to https://upstash.com
2. Create Redis database
3. Get host and password
4. Use in .env

### Option B: Use Docker (if you have Docker Desktop)

```powershell
docker run -d -p 6379:6379 redis
```

### Option C: Install Redis on Windows

1. Download from: https://github.com/microsoftarchive/redis/releases
2. Install and start service
3. Use: `REDIS_HOST=localhost`

## Running the Agent

### Start the Agent

```powershell
# Using the start script (recommended)
.\start-windows.ps1

# Or manually
npm run dev
```

### Verify It's Running

Open another PowerShell window:

```powershell
# Check health
Invoke-WebRequest -Uri http://localhost:3000/api/health

# Or use curl if installed
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "healthy",
"timestamp": "2026-05-15T...",
 "checks": {
   "database": true,
   "email": true,
   "whatsapp": true,
   "nvidia": true
 }
}
```

## Testing Without Database/Redis

If you just want to test the code compilation:

```powershell
# Build only
npm run build

# Check for errors
# If build succeeds, the code is valid!
```

## Common Issues & Solutions

### Issue: "Cannot find module"

**Solution**: Run `npm install` again

```powershell
Remove-Item node_modules -Recurse -Force
npm install
```

### Issue: "Port 3000 already in use"

**Solution**: Change port in .env

```bash
AGENT_PORT=3001
```

### Issue: "Database connection failed"

**Solutions**:
1. Check DATABASE_URL is correct
2. Verify PostgreSQL is running
3. Try cloud database (Supabase/Neon)
4. Set `AGENT_DRY_RUN=true` to test without database

### Issue: "Redis connection failed"

**Solutions**:
1. Check REDIS_HOST is correct
2. Verify Redis is running
3. Try cloud Redis (Upstash)
4. Comment out Redis code temporarily for testing

### Issue: PowerShell execution policy

If you get "script execution is disabled":

```powershell
# Run as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Quick Test (No Database Required)

Want to test the agent without setting up databases?

1. Set in `.env`:
```bash
AGENT_DRY_RUN=true
AGENT_ENABLED=true
```

2. Comment out database/Redis checks in `src/index.ts` (lines with `db.healthCheck()`)

3. Run:
```powershell
npm run build
npm run dev
```

4. Test API:
```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/agent/status
```

## Next Steps

Once the agent is running:

1. **Load Contacts**: Add your prospects to the database
2. **Test Dry Run**: Trigger outreach with `AGENT_DRY_RUN=true`
3. **Go Live**: Set `AGENT_DRY_RUN=false` and start real outreach
4. **Monitor**: Check logs and metrics

## Useful Commands

```powershell
# View logs
Get-Content logs\combined.log -Tail 50 -Wait

# Check status
Invoke-WebRequest -Uri http://localhost:3000/api/agent/status | Select-Object -Expand Content

# Trigger outreach
Invoke-WebRequest -Uri http://localhost:3000/api/agent/outreach/trigger -Method POST

# View statistics
Invoke-WebRequest -Uri http://localhost:3000/api/agent/outreach/stats | Select-Object -Expand Content
```

## Scripts Available

- `setup-windows.ps1` - Complete setup automation
- `start-windows.ps1` - Quick start script
- `npm run dev` - Start in development mode
- `npm run build` - Build TypeScript
- `npm start` - Start in production mode

## Support

- **Documentation**: See SETUP-GUIDE.md for detailed instructions
- **Quick Start**: See QUICK-START-EXECUTION.md
- **Deployment**: See DEPLOYMENT-GUIDE.md

## Troubleshooting

If you encounter any issues:

1. Check Node.js version: `node --version` (should be 18+)
2. Reinstall dependencies: `npm install`
3. Rebuild: `npm run build`
4. Check logs: `Get-Content logs\combined.log`
5. Verify .env file has all required keys

---

**Status**: ✅ Agent is ready to run on Windows!

Just configure your API keys in `.env` and run `.\start-windows.ps1`

# Made with Bob
