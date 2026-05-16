# 🎨 Sokogate Sales & Funding Assets - Frontend Setup Guide

## Overview
This guide covers the complete setup of the React TypeScript frontend dashboard for the Sokogate Sales and Funding Agent system.

## Architecture

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── api/              # API client and services
│   ├── components/       # Reusable UI components
│   ├── pages/           # Page components
│   ├── hooks/           # Custom React hooks
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   ├── App.tsx          # Main app component
│   └── index.tsx        # Entry point
└── package.json
```

## Installation Steps

### 1. Create React App (Already Running)
```bash
npx create-react-app frontend --template typescript
```

### 2. Install Dependencies
```bash
cd frontend
npm install axios react-router-dom @tanstack/react-query
npm install -D @types/react-router-dom
npm install recharts date-fns lucide-react
npm install tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 3. Configure Environment Variables
Create `frontend/.env`:
```env
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_API_TIMEOUT=10000
```

### 4. Configure Tailwind CSS
Update `frontend/tailwind.config.js`:
```javascript
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',
        secondary: '#64748b',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
      }
    },
  },
  plugins: [],
}
```

## Features

### Dashboard
- System health monitoring
- Real-time agent status
- Rate limit tracking
- Service health indicators

### Contact Management
- View all contacts (prospects, investors, partners)
- Filter and search functionality
- Contact details and interaction history
- Add/edit contacts

### Analytics
- Email/WhatsApp metrics
- Conversion tracking
- Response rate analysis
- Visual charts and graphs

### Agent Control
- Manual trigger controls
- Dry run mode toggle
- Feature flag management
- Configuration viewer

## API Integration

### Endpoints Used
- `GET /api/health` - System health check
- `GET /api/status` - Agent status and rate limits
- `POST /api/agent/trigger` - Manual workflow trigger
- `GET /api/contacts` - List contacts (to be implemented)
- `GET /api/metrics` - Analytics data (to be implemented)

## Running the Frontend

```bash
cd frontend
npm start
```

The app will open at `http://localhost:3001` (or next available port).

## Development Workflow

1. Backend must be running on port 3000
2. Frontend runs on port 3001
3. CORS is configured to allow cross-origin requests
4. Hot reload enabled for development

## Deployment

### Production Build
```bash
cd frontend
npm run build
```

### Serve Static Files
```bash
npm install -g serve
serve -s build -p 3001
```

## Troubleshooting

### CORS Issues
If you see CORS errors, verify backend CORS configuration in `agent/src/index.ts`.

### API Connection Failed
1. Check backend is running: `curl http://localhost:3000/api/health`
2. Verify REACT_APP_API_URL in `.env`
3. Check browser console for errors

### Build Errors
1. Clear node_modules: `rm -rf node_modules && npm install`
2. Clear cache: `npm cache clean --force`
3. Update dependencies: `npm update`

## Next Steps

After setup:
1. Test API connectivity
2. Verify all components render
3. Check responsive design
4. Test all user flows
5. Deploy to production

---

*Generated for Sokogate Sales & Funding Assets Project*

# Made with Bob
