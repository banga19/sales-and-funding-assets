# How to Get Your Supabase PostgreSQL Connection String

## The Problem

You have this in your `.env`:
```
DATABASE_URL=https://vgkwwnjzxnensaxjxmxk.supabase.co/rest/v1/
```

❌ This is the **REST API URL** - it won't work for PostgreSQL connections!

## What You Need

✅ The **PostgreSQL connection string** that looks like:
```
postgresql://postgres.vgkwwnjzxnensaxjxmxk:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

## How to Get It

### Step 1: Go to Supabase Dashboard
1. Open https://supabase.com/dashboard
2. Select your project: `vgkwwnjzxnensaxjxmxk`

### Step 2: Navigate to Database Settings
1. Click on **Settings** (gear icon in left sidebar)
2. Click on **Database**
3. Scroll down to **Connection String** section

### Step 3: Copy the Connection String
1. Look for **Connection string** section
2. Select **URI** tab (not REST or GraphQL)
3. You'll see something like:
   ```
   postgresql://postgres.vgkwwnjzxnensaxjxmxk:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
4. Replace `[YOUR-PASSWORD]` with your actual database password
5. Copy the complete string

### Step 4: Update Your .env File
1. Open `agent/.env`
2. Find line 39 (DATABASE_URL)
3. Replace with your connection string:
   ```bash
   DATABASE_URL=postgresql://postgres.vgkwwnjzxnensaxjxmxk:your_actual_password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

### Step 5: Test the Connection
```powershell
npm run dev
```

You should see:
```
info: New database connection established
info: Agent server started on port 3000
```

## Don't Have the Password?

If you don't remember your database password:

1. Go to Supabase Dashboard → Settings → Database
2. Click **Reset Database Password**
3. Set a new password
4. Use the new password in your connection string

## Alternative: Use Connection Pooler

For better performance, use the **pooler** connection string:

```
postgresql://postgres.vgkwwnjzxnensaxjxmxk:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Note the `.pooler.` in the hostname - this is recommended for applications.

## Quick Reference

**What you have (wrong)**:
```
https://vgkwwnjzxnensaxjxmxk.supabase.co/rest/v1/
```

**What you need (correct)**:
```
postgresql://postgres.vgkwwnjzxnensaxjxmxk:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
```

## Still Having Issues?

### Check if Supabase is accessible:
```powershell
Test-NetConnection -ComputerName aws-0-us-east-1.pooler.supabase.com -Port 6543
```

### Verify your connection string format:
- Starts with `postgresql://`
- Contains your project reference
- Has your password (no brackets)
- Ends with `/postgres`

### Common Mistakes:
❌ Using REST API URL instead of PostgreSQL URL  
❌ Forgetting to replace `[YOUR-PASSWORD]`  
❌ Using wrong port (should be 6543 for pooler, 5432 for direct)  
❌ Missing `/postgres` at the end  

---

Once you update the DATABASE_URL with the correct PostgreSQL connection string, the agent will start successfully!

# Made with Bob
