# Database Connection Fix - "Tenant or user not found" Error

## 🔍 Problem Diagnosed

**Error Code:** XX000 (FATAL)  
**Error Message:** "Tenant or user not found"  
**Root Cause:** Incorrect Supabase database connection string

## ✅ Solution

The connection string in your `.env` file is incorrect. You need to get the correct connection string from Supabase.

### Step 1: Get the Correct Connection String

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project: `vgkwwnjzxnensaxjxmxk`
3. Navigate to: **Settings** → **Database**
4. Scroll down to **Connection String** section
5. Select **URI** tab (NOT the REST API URL)
6. Choose **Transaction** mode (port 6543) or **Session** mode (port 5432)
7. Copy the connection string

### Step 2: Connection String Format

Your connection string should look like ONE of these:

**Transaction Pooler (Recommended for serverless):**
```
postgresql://postgres.vgkwwnjzxnensaxjxmxk:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

**Session Pooler (For long-running connections):**
```
postgresql://postgres.vgkwwnjzxnensaxjxmxk:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

**Direct Connection:**
```
postgresql://postgres:[YOUR-PASSWORD]@db.vgkwwnjzxnensaxjxmxk.supabase.co:5432/postgres
```

### Step 3: Common Issues

#### Issue 1: Wrong Password
- The password in your `.env` is: `sokogate_pass_2026`
- This might not be your actual Supabase database password
- **Fix:** Use the password you set when creating the Supabase project
- If forgotten, reset it in: Settings → Database → Database Password → Reset

#### Issue 2: Wrong Project Reference
- The project reference `vgkwwnjzxnensaxjxmxk` might be incorrect
- **Fix:** Verify in Supabase Dashboard → Settings → General → Reference ID

#### Issue 3: Wrong Region
- The region `us-east-1` might be incorrect
- **Fix:** Check your project region in Supabase Dashboard

### Step 4: Update Your .env File

1. Open `agent/.env`
2. Replace the `DATABASE_URL` line with the correct connection string
3. Make sure to use the actual password (not a placeholder)

Example:
```env
DATABASE_URL=postgresql://postgres.vgkwwnjzxnensaxjxmxk:YOUR_ACTUAL_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

### Step 5: Test the Connection

Run the test script:
```bash
cd agent
node test-db-connection.js
```

You should see:
```
✅ Connection successful!
✅ Query successful!
✅ All tests passed!
```

### Step 6: Restart the Application

```bash
npm run dev
```

## 🔐 Security Notes

1. **Never commit your actual password to Git**
2. Keep `.env` in `.gitignore`
3. Use environment variables in production
4. Consider using Supabase's connection pooler for better performance

## 📋 Quick Checklist

- [ ] Get correct connection string from Supabase Dashboard
- [ ] Verify project reference ID matches
- [ ] Verify region matches your project
- [ ] Use the correct database password
- [ ] Test connection with `node test-db-connection.js`
- [ ] Restart application with `npm run dev`

## 🆘 Still Having Issues?

If you still get "Tenant or user not found":

1. **Verify Project Exists:** Make sure the Supabase project is active
2. **Check Network:** Ensure no firewall is blocking Supabase
3. **IP Allowlist:** Check if Supabase has IP restrictions enabled
4. **Try Direct Connection:** Use the direct connection string instead of pooler
5. **Create New Password:** Reset your database password in Supabase

## 📞 Need the Connection String?

I cannot access your Supabase dashboard, so you need to:

1. Log in to https://supabase.com/dashboard
2. Find your project
3. Copy the connection string as described above
4. Update your `.env` file

The connection string contains sensitive information (password), so it must be retrieved securely from your Supabase account.

# Made with Bob
