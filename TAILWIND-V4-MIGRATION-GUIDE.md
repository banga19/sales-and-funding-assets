# Tailwind CSS v4 Migration Guide - PostCSS Plugin Error Resolution

## Problem Overview

When building a React project with Tailwind CSS v4, you may encounter this error:

```
Error: It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin. 
The PostCSS plugin has moved to a separate package, so to continue using Tailwind CSS 
with PostCSS you'll need to install `@tailwindcss/postcss` and update your PostCSS configuration.
```

## Root Cause

Tailwind CSS v4 has separated the PostCSS plugin into a standalone package (`@tailwindcss/postcss`). The main `tailwindcss` package can no longer be used directly as a PostCSS plugin.

## Complete Solution

### Step 1: Install Required Dependencies

Run the following command in your frontend directory:

```bash
npm install -D @tailwindcss/postcss tailwindcss@latest postcss@latest autoprefixer@latest
```

**PowerShell users:** Use semicolons instead of `&&`:
```powershell
cd frontend; npm install -D @tailwindcss/postcss tailwindcss@latest postcss@latest autoprefixer@latest
```

### Step 2: Update PostCSS Configuration

Your `postcss.config.js` should look like this:

```javascript
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
```

**Important:** Use `@tailwindcss/postcss` NOT `tailwindcss` in the plugins object.

### Step 3: Update CSS Files with Tailwind v4 Syntax

In your main CSS file (e.g., `src/index.css`), use the new v4 import syntax:

```css
@import "tailwindcss";

/* Your custom styles below */
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
}
```

**Note:** Tailwind v4 uses `@import "tailwindcss"` instead of the old v3 directives:
- ❌ Old (v3): `@tailwind base; @tailwind components; @tailwind utilities;`
- ✅ New (v4): `@import "tailwindcss";`

### Step 4: Tailwind Configuration (Optional)

Tailwind CSS v4 works without a configuration file by default. However, if you need customization, create `tailwind.config.js`:

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

### Step 5: Clear Cache and Reinstall (If Issues Persist)

If you still encounter errors after the above steps, clear the npm cache and reinstall:

**Windows PowerShell:**
```powershell
cd frontend
npm cache clean --force
if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
if (Test-Path package-lock.json) { Remove-Item -Force package-lock.json }
npm install
```

**macOS/Linux:**
```bash
cd frontend
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Step 6: Restart Development Server

After making changes, restart your development server:

```bash
npm start
```

## Verification Checklist

- [ ] `@tailwindcss/postcss` is installed in `devDependencies`
- [ ] `postcss.config.js` uses `@tailwindcss/postcss` (not `tailwindcss`)
- [ ] CSS files use `@import "tailwindcss"` (not `@tailwind` directives)
- [ ] `node_modules` and cache cleared if issues persist
- [ ] Development server restarted

## Common Mistakes to Avoid

1. **Using old v3 syntax in PostCSS config:**
   ```javascript
   // ❌ WRONG
   plugins: {
     tailwindcss: {},  // This will cause the error
   }
   
   // ✅ CORRECT
   plugins: {
     '@tailwindcss/postcss': {},
   }
   ```

2. **Using old v3 CSS directives:**
   ```css
   /* ❌ WRONG (v3 syntax) */
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   
   /* ✅ CORRECT (v4 syntax) */
   @import "tailwindcss";
   ```

3. **Not clearing cache after changes:**
   - Always clear npm cache and reinstall if switching between versions

## Package.json Reference

Your `devDependencies` should include:

```json
{
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.0",
    "autoprefixer": "^10.5.0",
    "postcss": "^8.5.14",
    "tailwindcss": "^4.3.0"
  }
}
```

## Troubleshooting

### Error persists after following all steps?

1. **Check for multiple CSS files:** Ensure ALL CSS files that import Tailwind use the v4 syntax
2. **Verify PostCSS config location:** Should be in project root or frontend directory
3. **Check for cached builds:** Delete `.cache` or `build` directories
4. **Restart VS Code:** Sometimes the IDE needs a restart to pick up changes

### Build works but styles not applying?

1. Verify `content` paths in `tailwind.config.js` match your file structure
2. Check that CSS file is imported in your main entry file (e.g., `index.tsx`)
3. Inspect browser DevTools to see if Tailwind classes are being generated

## Additional Resources

- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [PostCSS Plugin Migration Guide](https://tailwindcss.com/docs/upgrade-guide)
- [@tailwindcss/postcss Package](https://www.npmjs.com/package/@tailwindcss/postcss)

## Summary

The key changes for Tailwind CSS v4:
1. Install `@tailwindcss/postcss` package
2. Update PostCSS config to use `@tailwindcss/postcss`
3. Replace `@tailwind` directives with `@import "tailwindcss"`
4. Clear cache and reinstall if needed

---

**Created:** 2026-05-16  
**Last Updated:** 2026-05-16

# Made with Bob
