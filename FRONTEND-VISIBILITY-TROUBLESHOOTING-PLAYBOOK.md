# 🔍 Frontend Visibility Issues - Comprehensive Technical Audit & Debugging Playbook

**Project:** Sales and Funding Assets - AI Agent System  
**Date:** 2026-05-16  
**Status:** Backend Running (Partially Healthy) | No Frontend Detected  

---

## 📊 EXECUTIVE SUMMARY

### Current System Status
- ✅ **Backend Server:** Running on `http://localhost:3000`
- ✅ **Database:** Connected and healthy (PostgreSQL/Supabase)
- ⚠️ **WhatsApp Service:** Unhealthy (401 Unauthorized - Invalid credentials)
- ❌ **Claude AI Service:** Unhealthy (400 Bad Request - Insufficient credits)
- ❌ **Frontend:** Not detected in project structure

### Root Cause Analysis
**PRIMARY ISSUE:** This is a **backend-only API project** with no frontend application. The "frontend visibility issues" stem from the absence of a client-side application to consume the API.

**SECONDARY ISSUES:**
1. WhatsApp API credentials are placeholder values (`xxx`)
2. Anthropic Claude API has insufficient credits
3. Port conflict: `.env` specifies both port 3001 and 3000

---

## 🏗️ ARCHITECTURAL ANALYSIS

### 1. Network & Connectivity Layer

#### ✅ Backend Accessibility
```bash
# Test Command
curl http://localhost:3000/api/health

# Current Response (503 Service Unavailable)
{
  "status": "unhealthy",
  "timestamp": "2026-05-16T08:37:38.637Z",
  "checks": {
    "database": { "healthy": true },
    "email": true,
    "whatsapp": false,
    "claude": false
  }
}
```

#### CORS Configuration
**Location:** `agent/src/index.ts:28`
```typescript
this.app.use(cors()); // Default CORS - allows all origins
```

**Status:** ✅ CORS is properly configured (permissive for development)

**Production Recommendation:**
```typescript
this.app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
```

#### Port Configuration Issues
**Problem:** Conflicting port definitions in `.env`
```env
Line 96:  AGENT_PORT=3001
Line 119: AGENT_PORT=3000  # Duplicate - this one takes precedence
```

**Fix:**
```bash
# Remove duplicate and use consistent port
AGENT_PORT=3000
```

---

### 2. Backend & Database Integration Layer

#### ✅ Database Connection
**Status:** Healthy and operational

**Connection String:** (Masked for security)
```
postgresql://postgres.vgkwwnjzxnensaxjxmxk:****@aws-1-eu-west-2.pooler.supabase.com:6543/postgres
```

**Verification Commands:**
```bash
# Test database connectivity
cd agent
node -e "require('dotenv').config(); const {Pool} = require('pg'); const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}}); pool.query('SELECT NOW()', (err, res) => {console.log(err ? err : 'DB Connected:', res.rows[0]); pool.end();});"
```

**Health Check Endpoint:**
```bash
curl http://localhost:3000/api/health | jq '.checks.database'
```

#### Available API Endpoints
```
GET  /api/health          - System health check
GET  /api/status          - Agent status and rate limits
POST /api/agent/trigger   - Manual workflow trigger
POST /api/webhooks/whatsapp  - WhatsApp webhook receiver
POST /api/webhooks/email     - Email webhook receiver
POST /api/webhooks/calendly  - Calendly webhook receiver
```

---

### 3. Service Health Issues

#### ❌ WhatsApp Service (401 Unauthorized)

**Error Details:**
```json
{
  "error": {
    "message": "Request failed with status code 401",
    "status": 401,
    "config": {
      "baseURL": "https://graph.facebook.com/v18.0/xxx",
      "headers": {
        "Authorization": "Bearer xxx"
      }
    }
  }
}
```

**Root Cause:** Placeholder credentials in `.env`
```env
WHATSAPP_BUSINESS_ACCOUNT_ID=xxx
WHATSAPP_ACCESS_TOKEN=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
```

**Fix Steps:**
1. Go to [Meta Business Suite](https://business.facebook.com/)
2. Navigate to WhatsApp → API Setup
3. Copy the following values:
   - Business Account ID
   - Access Token (permanent token)
   - Phone Number ID
4. Update `.env` file with real values
5. Restart the server: `npm run dev`

**Temporary Workaround (Disable WhatsApp):**
```env
ENABLE_WHATSAPP=false
```

#### ❌ Claude AI Service (400 - Insufficient Credits)

**Error Details:**
```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
  }
}
```

**Root Cause:** Anthropic API account has insufficient credits

**Fix Steps:**
1. Visit [Anthropic Console](https://console.anthropic.com/)
2. Go to Settings → Billing
3. Add credits or upgrade plan
4. Verify API key is correct in `.env`

**Verification:**
```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

---

### 4. Frontend Analysis

#### ❌ No Frontend Application Detected

**Project Structure:**
```
sales-and-funding-assets/
├── agent/                    # Backend API (Node.js/Express)
│   ├── src/
│   │   ├── index.ts         # Main server file
│   │   ├── api/             # API routes
│   │   ├── agents/          # AI agent logic
│   │   ├── channels/        # Email/WhatsApp services
│   │   └── database/        # Database client
│   └── package.json
├── *.md                      # Documentation files
└── *.csv                     # Data tracking files
```

**Conclusion:** This is a **headless API service** without a frontend UI.

#### Options to Add Frontend Visibility

**Option 1: Create a Simple Admin Dashboard**
```bash
# Create React frontend
npx create-react-app frontend
cd frontend

# Install dependencies
npm install axios react-router-dom @tanstack/react-query

# Create API client
cat > src/api/client.js << 'EOF'
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

export const getHealth = () => apiClient.get('/health');
export const getStatus = () => apiClient.get('/status');
EOF

# Update .env
echo "REACT_APP_API_URL=http://localhost:3000/api" > .env

# Start frontend
npm start
```

**Option 2: Use API Testing Tools**
- **Postman:** Import API collection
- **Insomnia:** REST client
- **Thunder Client:** VS Code extension
- **curl/httpie:** Command-line testing

**Option 3: Build Custom Dashboard**
```bash
# Using Next.js (recommended for production)
npx create-next-app@latest frontend --typescript --tailwind --app
cd frontend
npm install axios swr
```

---

## 🔧 DIAGNOSTIC CHECKLIST

### HTTP Error Code Mapping

| Status Code | Meaning | Likely Cause | Fix |
|-------------|---------|--------------|-----|
| **200** | OK | Request successful | ✅ Normal operation |
| **400** | Bad Request | Invalid request format or insufficient API credits | Check request body, verify API credits |
| **401** | Unauthorized | Invalid or missing credentials | Update API keys in `.env` |
| **403** | Forbidden | Valid credentials but insufficient permissions | Check API key permissions |
| **404** | Not Found | Endpoint doesn't exist | Verify URL path |
| **500** | Internal Server Error | Backend crash or unhandled exception | Check server logs |
| **502** | Bad Gateway | Backend not responding | Verify backend is running |
| **503** | Service Unavailable | Service degraded (partial health) | Check `/api/health` endpoint |
| **504** | Gateway Timeout | Backend taking too long | Check database connection |

### Console Error Patterns

#### Network Errors
```javascript
// CORS Error
Access to fetch at 'http://localhost:3000/api/health' from origin 'http://localhost:3001' 
has been blocked by CORS policy

// Fix: Update CORS configuration in backend
```

```javascript
// Connection Refused
net::ERR_CONNECTION_REFUSED

// Fix: Verify backend is running on correct port
```

#### API Errors
```javascript
// 401 Unauthorized
{
  "error": "Unauthorized",
  "message": "Invalid API key"
}

// Fix: Update credentials in .env
```

---

## 🚀 STEP-BY-STEP VERIFICATION PROTOCOL

### Phase 1: Backend Health Verification

```bash
# Step 1: Check if backend is running
curl http://localhost:3000/api/health

# Expected: JSON response (even if unhealthy)
# If connection refused: Backend not running

# Step 2: Check backend logs
cd agent
npm run dev

# Look for:
# ✅ "Sales & Funding Agent started"
# ✅ "Database connection verified successfully"
# ⚠️  Service health check failures (non-critical)

# Step 3: Test database directly
curl http://localhost:3000/api/health | jq '.checks.database'

# Expected: { "healthy": true }
```

### Phase 2: Service Configuration Audit

```bash
# Step 1: Validate environment variables
cd agent
node -e "require('dotenv').config(); console.log('Port:', process.env.AGENT_PORT); console.log('DB:', process.env.DATABASE_URL ? 'Set' : 'Missing'); console.log('Anthropic:', process.env.ANTHROPIC_API_KEY ? 'Set' : 'Missing');"

# Step 2: Check for placeholder values
grep -E "xxx|YOUR_|REPLACE" .env

# Step 3: Verify port availability
netstat -ano | findstr :3000

# If port in use, kill process or change port
```

### Phase 3: API Endpoint Testing

```bash
# Test all endpoints
curl http://localhost:3000/api/health
curl http://localhost:3000/api/status
curl -X POST http://localhost:3000/api/agent/trigger \
  -H "Content-Type: application/json" \
  -d '{"action":"test","contact_id":"123"}'
```

### Phase 4: Frontend Integration (If Applicable)

```bash
# If you have a frontend, check:

# 1. Environment variables
cat frontend/.env
# Should contain: REACT_APP_API_URL=http://localhost:3000/api

# 2. API client configuration
grep -r "baseURL\|API_URL" frontend/src

# 3. Network tab in browser
# Open DevTools → Network → Filter: XHR
# Look for failed requests to /api/*
```

---

## 🛠️ QUICK FIX COMMANDS

### Fix 1: Resolve Port Conflict
```bash
cd agent
# Edit .env and remove duplicate AGENT_PORT line
sed -i '119d' .env  # Remove line 119 (Windows: use text editor)
```

### Fix 2: Disable Failing Services (Temporary)
```bash
# Edit .env
cat >> .env << 'EOF'

# Temporary: Disable services with invalid credentials
ENABLE_WHATSAPP=false
EOF

# Restart server
npm run dev
```

### Fix 3: Test Database Connection
```bash
cd agent
node test-db-connection.js

# If fails, verify:
# 1. DATABASE_URL is correct
# 2. Database password is valid
# 3. IP is whitelisted in Supabase
```

### Fix 4: Create Simple Frontend Test Page
```html
<!-- Save as test-frontend.html -->
<!DOCTYPE html>
<html>
<head>
    <title>API Test</title>
</head>
<body>
    <h1>Backend API Test</h1>
    <button onclick="testAPI()">Test Health Endpoint</button>
    <pre id="result"></pre>
    
    <script>
        async function testAPI() {
            try {
                const response = await fetch('http://localhost:3000/api/health');
                const data = await response.json();
                document.getElementById('result').textContent = 
                    JSON.stringify(data, null, 2);
            } catch (error) {
                document.getElementById('result').textContent = 
                    'Error: ' + error.message;
            }
        }
    </script>
</body>
</html>
```

---

## 📋 COMPLETE TROUBLESHOOTING WORKFLOW

### Scenario 1: "Cannot connect to backend"

```bash
# 1. Verify backend is running
Get-Process node

# 2. Check port
netstat -ano | findstr :3000

# 3. Test locally
curl http://localhost:3000/api/health

# 4. Check firewall
# Windows: Settings → Firewall → Allow app through firewall → Node.js

# 5. Restart backend
cd agent
npm run dev
```

### Scenario 2: "API returns 503 Service Unavailable"

```bash
# This is EXPECTED with current configuration
# The backend is running but some services are unhealthy

# Check which services are failing
curl http://localhost:3000/api/health | jq '.checks'

# Fix critical services only:
# - Database: Must be healthy (currently ✅)
# - Email: Must be healthy (currently ✅)
# - WhatsApp: Optional (currently ❌ - invalid credentials)
# - Claude: Optional (currently ❌ - no credits)
```

### Scenario 3: "Need to see what the system is doing"

```bash
# Option 1: Monitor logs
cd agent
npm run dev

# Option 2: Use API endpoints
curl http://localhost:3000/api/status

# Option 3: Check database directly
# Use Supabase Dashboard: https://vgkwwnjzxnensaxjxmxk.supabase.co

# Option 4: Build simple dashboard (see Frontend Options above)
```

---

## 🎯 RECOMMENDED IMMEDIATE ACTIONS

### Priority 1: Fix Configuration Issues
```bash
cd agent

# 1. Remove duplicate port definition
# Edit .env, keep only one AGENT_PORT=3000

# 2. Disable non-critical services
# Edit .env:
ENABLE_WHATSAPP=false

# 3. Restart server
npm run dev
```

### Priority 2: Add Frontend Visibility

**Quick Solution (5 minutes):**
```bash
# Create simple HTML test page
cat > test-dashboard.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Sales Agent Dashboard</title>
    <style>
        body { font-family: Arial; padding: 20px; }
        .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
        .healthy { background: #d4edda; }
        .unhealthy { background: #f8d7da; }
        button { padding: 10px 20px; margin: 5px; cursor: pointer; }
    </style>
</head>
<body>
    <h1>🤖 Sales & Funding Agent Dashboard</h1>
    
    <button onclick="checkHealth()">Check Health</button>
    <button onclick="checkStatus()">Check Status</button>
    
    <div id="output"></div>
    
    <script>
        const API_BASE = 'http://localhost:3000/api';
        
        async function checkHealth() {
            try {
                const res = await fetch(`${API_BASE}/health`);
                const data = await res.json();
                displayHealth(data);
            } catch (err) {
                document.getElementById('output').innerHTML = 
                    `<div class="status unhealthy">❌ Error: ${err.message}</div>`;
            }
        }
        
        async function checkStatus() {
            try {
                const res = await fetch(`${API_BASE}/status`);
                const data = await res.json();
                displayStatus(data);
            } catch (err) {
                document.getElementById('output').innerHTML = 
                    `<div class="status unhealthy">❌ Error: ${err.message}</div>`;
            }
        }
        
        function displayHealth(data) {
            const checks = Object.entries(data.checks).map(([service, status]) => {
                const healthy = typeof status === 'boolean' ? status : status.healthy;
                const icon = healthy ? '✅' : '❌';
                const className = healthy ? 'healthy' : 'unhealthy';
                return `<div class="status ${className}">${icon} ${service}: ${healthy ? 'Healthy' : 'Unhealthy'}</div>`;
            }).join('');
            
            document.getElementById('output').innerHTML = `
                <h2>System Health</h2>
                <div class="status ${data.status === 'healthy' ? 'healthy' : 'unhealthy'}">
                    Overall Status: ${data.status.toUpperCase()}
                </div>
                ${checks}
            `;
        }
        
        function displayStatus(data) {
            document.getElementById('output').innerHTML = `
                <h2>Agent Status</h2>
                <div class="status ${data.enabled ? 'healthy' : 'unhealthy'}">
                    Agent Enabled: ${data.enabled ? 'Yes' : 'No'}
                </div>
                <div class="status">Dry Run Mode: ${data.dryRun ? 'Yes' : 'No'}</div>
                <div class="status">Email Remaining Today: ${data.rateLimits.email.remaining}/${data.rateLimits.email.limit}</div>
                <pre>${JSON.stringify(data, null, 2)}</pre>
            `;
        }
        
        // Auto-check on load
        checkHealth();
    </script>
</body>
</html>
EOF

# Open in browser
start test-dashboard.html
```

**Production Solution (30 minutes):**
```bash
# Create React dashboard
npx create-react-app agent-dashboard
cd agent-dashboard
npm install axios recharts
# Follow React setup in "Frontend Options" section above
```

### Priority 3: Fix API Credentials

```bash
# 1. Add credits to Anthropic account
# Visit: https://console.anthropic.com/settings/billing

# 2. Get real WhatsApp credentials (if needed)
# Visit: https://business.facebook.com/

# 3. Update .env with real values

# 4. Restart server
cd agent
npm run dev
```

---

## 📞 SUPPORT & ESCALATION

### When to Escalate

1. **Database connection fails** → Critical (blocks all operations)
2. **Backend won't start** → Critical (no API available)
3. **CORS errors persist** → High (blocks frontend integration)
4. **Email service fails** → Medium (core feature unavailable)
5. **WhatsApp/Claude fails** → Low (optional features)

### Debug Information to Collect

```bash
# System info
node --version
npm --version

# Backend logs
cd agent
npm run dev > logs.txt 2>&1

# Environment check
cd agent
node -e "require('dotenv').config(); console.log(JSON.stringify({port: process.env.AGENT_PORT, dbSet: !!process.env.DATABASE_URL, aiSet: !!process.env.ANTHROPIC_API_KEY}, null, 2));"

# Network test
curl -v http://localhost:3000/api/health

# Package versions
cd agent
npm list --depth=0
```

---

## ✅ SUCCESS CRITERIA

### Backend Health
- [ ] Server starts without errors
- [ ] Database connection is healthy
- [ ] `/api/health` returns 200 or 503 (partial health acceptable)
- [ ] `/api/status` returns agent configuration

### API Accessibility
- [ ] Can access endpoints from localhost
- [ ] CORS allows frontend origin (if frontend exists)
- [ ] Endpoints return valid JSON responses

### Service Status
- [x] Database: Healthy ✅
- [x] Email: Healthy ✅
- [ ] WhatsApp: Healthy or disabled
- [ ] Claude AI: Healthy or disabled

### Frontend Integration (If Applicable)
- [ ] Frontend can connect to backend
- [ ] API calls succeed
- [ ] Error handling works
- [ ] Data displays correctly

---

## 🔗 USEFUL RESOURCES

### Documentation
- [Express.js CORS](https://expressjs.com/en/resources/middleware/cors.html)
- [PostgreSQL Connection Strings](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING)
- [Supabase Documentation](https://supabase.com/docs)
- [Anthropic API Docs](https://docs.anthropic.com/)

### Tools
- **API Testing:** Postman, Insomnia, Thunder Client
- **Database:** Supabase Dashboard, pgAdmin, DBeaver
- **Monitoring:** Winston logs (already integrated)
- **Debugging:** VS Code debugger, Chrome DevTools

### Quick Links
- Supabase Dashboard: https://vgkwwnjzxnensaxjxmxk.supabase.co
- Anthropic Console: https://console.anthropic.com/
- Meta Business Suite: https://business.facebook.com/

---

## 📝 CONCLUSION

**Current State:** The backend API is operational with database connectivity. The system is experiencing "frontend visibility issues" because **no frontend application exists** in the project structure.

**Next Steps:**
1. ✅ Backend is running and accessible
2. ⚠️ Fix optional service credentials (WhatsApp, Claude)
3. ❌ **Create frontend application** to visualize data
4. ✅ Database integration is working correctly

**Recommendation:** Build a simple admin dashboard using the HTML template provided above, or create a full React/Next.js application for production use.

---

*Generated by Bob - Technical Audit System*  
*Last Updated: 2026-05-16T08:38:00Z*

# Made with Bob
