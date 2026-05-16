# Sokogate Sales & Funding Agent - Frontend Dashboard

A modern React TypeScript dashboard for monitoring and managing the AI-powered sales and funding agent system.

## 🚀 Features

- **Real-time System Health Monitoring** - Track database, email, WhatsApp, and AI service status
- **Agent Configuration Dashboard** - View and monitor agent settings and feature flags
- **Rate Limit Tracking** - Visual progress bars for email and WhatsApp daily limits
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Auto-refresh** - Dashboard updates every 30 seconds automatically
- **Error Handling** - Comprehensive error messages with troubleshooting tips

## 📋 Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0
- Backend API running on `http://localhost:3000`

## 🛠️ Installation

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

The application will open at `http://localhost:3001`

## 🔧 Configuration

### Environment Variables

Create a `.env.local` file in the frontend directory:

```env
PORT=3001
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_API_TIMEOUT=10000
REACT_APP_ENABLE_MOCK_DATA=false
```

### API Endpoints Used

- `GET /api/health` - System health check
- `GET /api/status` - Agent status and configuration
- `POST /api/agent/trigger` - Manual workflow trigger (future)

## 📁 Project Structure

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── api/
│   │   └── client.ts          # API client with axios
│   ├── types/
│   │   └── index.ts           # TypeScript type definitions
│   ├── App.tsx                # Main dashboard component
│   ├── App.css                # Tailwind CSS styles
│   ├── index.tsx              # Application entry point
│   └── index.css              # Global styles
├── .env.local                 # Local environment variables
├── tailwind.config.js         # Tailwind CSS configuration
├── postcss.config.js          # PostCSS configuration
└── package.json
```

## 🎨 Tech Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first CSS framework
- **Axios** - HTTP client
- **Lucide React** - Icon library
- **React Query** - Data fetching (ready for integration)

## 🔍 Dashboard Sections

### 1. System Health Overview
- Overall system status badge
- Individual service health indicators:
  - Database (PostgreSQL/Supabase)
  - Email Service (Resend)
  - WhatsApp Service (Meta Business API)
  - Claude AI (Anthropic)

### 2. Agent Configuration
- Agent enabled/disabled status
- Dry run mode indicator
- Feature flags status

### 3. Rate Limits
- Email daily limit progress bar
- WhatsApp daily limit progress bar
- Remaining capacity indicators

### 4. Feature Status
- Grid view of all feature flags
- Visual on/off indicators

### 5. Quick Actions
- Send test email
- View logs
- View contacts
- (More actions coming soon)

## 🐛 Troubleshooting

### Connection Errors

If you see "Connection Error":

1. **Verify backend is running:**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Check environment variables:**
   ```bash
   cat .env.local
   ```

3. **Verify CORS configuration** in backend (`agent/src/index.ts`)

### Build Errors

If you encounter build errors:

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear npm cache
npm cache clean --force
```

### Tailwind CSS Not Working

If styles aren't applying:

1. Verify `tailwind.config.js` exists
2. Check `postcss.config.js` configuration
3. Ensure `@tailwind` directives are in `src/index.css`
4. Restart development server

## 📊 API Response Examples

### Health Check Response
```json
{
  "status": "healthy",
  "timestamp": "2026-05-16T08:37:38.637Z",
  "checks": {
    "database": { "healthy": true },
    "email": true,
    "whatsapp": false,
    "claude": false
  }
}
```

### Status Response
```json
{
  "enabled": true,
  "dryRun": true,
  "features": {
    "whatsapp": true,
    "email": true,
    "autoFollowup": true,
    "autoScheduling": true,
    "sentimentAnalysis": true,
    "objectionHandling": true
  },
  "rateLimits": {
    "email": {
      "remaining": 50,
      "limit": 50
    },
    "whatsapp": {
      "remaining": 100,
      "limit": 100
    }
  }
}
```

## 🚀 Deployment

### Production Build

```bash
npm run build
```

This creates an optimized production build in the `build/` directory.

### Serve Production Build

```bash
# Install serve globally
npm install -g serve

# Serve the build
serve -s build -p 3001
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

### Deploy to Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=build
```

## 🔐 Security Considerations

- API URL is configurable via environment variables
- No sensitive data stored in frontend
- CORS properly configured on backend
- All API calls use HTTPS in production

## 📈 Future Enhancements

- [ ] Contact management interface
- [ ] Analytics and metrics dashboard
- [ ] Real-time notifications
- [ ] Agent control panel
- [ ] Message history viewer
- [ ] Performance metrics charts
- [ ] Export functionality
- [ ] Dark mode support

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## 📝 License

MIT License - See LICENSE file for details

## 🆘 Support

For issues or questions:
- Check the troubleshooting guide above
- Review backend logs: `cd agent && npm run dev`
- Consult the main project README
- Check the debugging playbook: `FRONTEND-VISIBILITY-TROUBLESHOOTING-PLAYBOOK.md`

---

**Built with ❤️ for Sokogate**

# Made with Bob
