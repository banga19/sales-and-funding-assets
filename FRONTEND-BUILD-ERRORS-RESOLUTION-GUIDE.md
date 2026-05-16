# Frontend Build Errors - Comprehensive Resolution Guide

## Problem Summary

Your React frontend is experiencing two critical categories of errors:

### 1. **Tailwind CSS v4 PostCSS Configuration Error**
```
Error: It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin.
The PostCSS plugin has moved to a separate package...
```

### 2. **Corrupted node_modules & Missing Dependencies**
- Multiple "Module not found" errors
- ENOENT errors for webpack, babel-loader, react packages
- Incomplete package installations

### 3. **OneDrive Sync Conflicts**
- Project path contains Chinese characters: `C:\Users\LapTop\OneDrive\文档\UTCLTD\`
- OneDrive may be interfering with node_modules file operations

---

## Root Causes

1. **Tailwind v4 Migration Issue**: Your `postcss.config.js` correctly references `@tailwindcss/postcss`, BUT the old `tailwindcss` package is still installed and conflicting
2. **Corrupted Dependencies**: node_modules is incomplete/corrupted, likely due to:
   - OneDrive sync conflicts
   - Interrupted installations
   - File locking issues on Windows
3. **Path Issues**: Chinese characters in path may cause encoding problems

---

## SOLUTION: Step-by-Step Fix

### **STEP 1: Stop All Running Processes**

Close all terminals running `npm start` or `npm run dev`:
```powershell
# Press Ctrl+C in each terminal to stop processes
```

### **STEP 2: Complete Clean Slate (Run in PowerShell)**

```powershell
# Navigate to frontend directory
cd "C:\Users\LapTop\OneDrive\文档\UTCLTD\sales-and-funding-assets\frontend"

# Force stop any node processes
taskkill /F /IM node.exe 2>$null

# Clean npm cache aggressively
npm cache clean --force
npm cache verify

# Remove ALL build artifacts and dependencies
if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
if (Test-Path package-lock.json) { Remove-Item -Force package-lock.json }
if (Test-Path .cache) { Remove-Item -Recurse -Force .cache }
if (Test-Path build) { Remove-Item -Recurse -Force build }

# Wait for OneDrive to sync (important!)
Write-Host "Waiting 10 seconds for OneDrive sync..." -ForegroundColor Yellow
Start-Sleep -Seconds 10
```

### **STEP 3: Fix Tailwind CSS Configuration**

The issue is that you have BOTH `tailwindcss` v4 AND `@tailwindcss/postcss` installed. You need to:

**Option A: Use Tailwind v4 with @tailwindcss/postcss (RECOMMENDED)**

Your current `postcss.config.js` is correct:
```javascript
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
```

But you need to ensure ONLY the correct packages are installed:

```powershell
# Remove old tailwindcss if it exists
npm uninstall tailwindcss

# Install correct Tailwind v4 packages
npm install --save-dev @tailwindcss/postcss@latest tailwindcss@latest postcss@latest autoprefixer@latest
```

**Option B: Downgrade to Tailwind v3 (Alternative)**

If v4 continues to cause issues:

```powershell
# Remove v4 packages
npm uninstall @tailwindcss/postcss tailwindcss

# Install v3
npm install --save-dev tailwindcss@3.4.1 postcss@8.4.35 autoprefixer@10.4.17
```

Then update `postcss.config.js`:
```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

And create `tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### **STEP 4: Fresh Dependency Installation**

```powershell
# Install all dependencies fresh
npm install

# If you get errors, try with legacy peer deps
npm install --legacy-peer-deps

# Verify installation
npm list --depth=0
```

### **STEP 5: Verify Critical Packages**

```powershell
# Check if key packages are installed
npm list react react-dom axios @tanstack/react-query
```

If any are missing:
```powershell
npm install react@latest react-dom@latest axios@latest @tanstack/react-query@latest
```

### **STEP 6: Test the Build**

```powershell
# Try starting the dev server
npm start
```

---

## OneDrive Considerations

### **Issue**: OneDrive Sync Conflicts

OneDrive can interfere with `node_modules` because:
- It tries to sync thousands of small files
- File locking conflicts during npm operations
- Encoding issues with non-ASCII paths

### **Solutions**:

**Option 1: Exclude node_modules from OneDrive (RECOMMENDED)**

1. Right-click the `frontend` folder
2. Select "Always keep on this device" or "Free up space"
3. Or add to OneDrive exclusions

**Option 2: Move Project Outside OneDrive**

```powershell
# Move project to local drive
$source = "C:\Users\LapTop\OneDrive\文档\UTCLTD\sales-and-funding-assets"
$destination = "C:\Dev\sales-and-funding-assets"

# Create destination
New-Item -ItemType Directory -Force -Path "C:\Dev"

# Copy project (excluding node_modules)
robocopy $source $destination /E /XD node_modules .git

# Navigate to new location
cd $destination\frontend

# Install dependencies
npm install
```

**Option 3: Configure OneDrive to Skip node_modules**

Add to `.gitignore` and OneDrive settings:
```
node_modules/
.cache/
build/
dist/
```

---

## Troubleshooting Common Errors

### Error: "Can't resolve 'react/jsx-dev-runtime'"

**Cause**: React 19 package corruption

**Fix**:
```powershell
npm install react@latest react-dom@latest --force
```

### Error: "Can't resolve 'axios'"

**Cause**: Missing dependency

**Fix**:
```powershell
npm install axios@latest
```

### Error: "Can't resolve 'webpack/hot/log.js'"

**Cause**: Incomplete webpack installation

**Fix**:
```powershell
npm install webpack webpack-dev-server --save-dev --force
```

### Error: "core-js-pure" module not found

**Cause**: Missing peer dependency

**Fix**:
```powershell
npm install core-js-pure@latest
```

### Persistent Errors After Clean Install

**Nuclear Option**:
```powershell
# Delete everything and start over
cd ..
Remove-Item -Recurse -Force frontend\node_modules
Remove-Item -Force frontend\package-lock.json

# Reinstall with specific npm version
npm install -g npm@latest
cd frontend
npm install --legacy-peer-deps
```

---

## Prevention: Best Practices

1. **Always use `--legacy-peer-deps`** if you encounter peer dependency conflicts
2. **Pause OneDrive** during npm operations
3. **Use shorter paths** without special characters
4. **Regular cache cleaning**: `npm cache clean --force`
5. **Lock file management**: Commit `package-lock.json` to git
6. **Node version**: Use LTS version (v20.x recommended)

---

## Quick Reference Commands

```powershell
# Complete reset
cd frontend
npm cache clean --force
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install

# Fix Tailwind v4
npm uninstall tailwindcss
npm install --save-dev @tailwindcss/postcss@latest tailwindcss@latest

# Fix React issues
npm install react@latest react-dom@latest --force

# Start dev server
npm start

# Build for production
npm run build
```

---

## Current Status Check

Run this to see what's installed:
```powershell
cd frontend
npm list --depth=0 | Select-String "tailwind|postcss|react|axios"
```

Expected output:
```
├── @tailwindcss/postcss@4.3.0
├── tailwindcss@4.3.0
├── postcss@8.5.14
├── autoprefixer@10.5.0
├── react@19.2.6
├── react-dom@19.2.6
├── axios@1.16.1
```

---

## Need More Help?

If errors persist:

1. **Check Node version**: `node --version` (should be v18+ or v20+)
2. **Check npm version**: `npm --version` (should be v9+ or v10+)
3. **Check for file locks**: Close VS Code, restart terminal
4. **Check OneDrive status**: Ensure it's not actively syncing
5. **Try different terminal**: Use Command Prompt instead of PowerShell

---

**Last Updated**: 2026-05-16
**Status**: Awaiting npm install completion in Terminal 3

# Made with Bob
