# Sokogate Sales & Funding Agent - Windows Setup Script
# Run this script in PowerShell to set up the agent

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Sokogate Sales & Funding Agent" -ForegroundColor Cyan
Write-Host "Windows Setup Script" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js installed: $nodeVersion" -ForegroundColor Green
    
    # Check if version is 18 or higher
    $versionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($versionNumber -lt 18) {
        Write-Host "✗ Node.js version must be 18 or higher" -ForegroundColor Red
        Write-Host "  Please install from: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "✗ Node.js not found" -ForegroundColor Red
    Write-Host "  Please install from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check if .env exists
Write-Host ""
Write-Host "Checking environment configuration..." -ForegroundColor Yellow
if (!(Test-Path ".env")) {
    Write-Host "✓ Creating .env from template..." -ForegroundColor Green
    Copy-Item ".env.example" ".env"
    Write-Host "  Please edit .env with your API keys:" -ForegroundColor Yellow
    Write-Host "  - ANTHROPIC_API_KEY (required)" -ForegroundColor Yellow
    Write-Host "  - RESEND_API_KEY (required)" -ForegroundColor Yellow
    Write-Host "  - DATABASE_URL (required)" -ForegroundColor Yellow
    Write-Host "  - REDIS_HOST (required)" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Open .env in notepad now? (y/n)"
    if ($response -eq 'y') {
        notepad .env
    }
} else {
    Write-Host "✓ .env file exists" -ForegroundColor Green
}

# Install dependencies
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
    exit 1
}

# Build TypeScript
Write-Host ""
Write-Host "Building TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Build successful" -ForegroundColor Green
} else {
    Write-Host "✗ Build failed" -ForegroundColor Red
    exit 1
}

# Check for dist folder
if (Test-Path "dist") {
    Write-Host "✓ Compiled files in dist/ folder" -ForegroundColor Green
} else {
    Write-Host "✗ dist/ folder not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Make sure PostgreSQL is running" -ForegroundColor White
Write-Host "2. Make sure Redis is running" -ForegroundColor White
Write-Host "3. Run database migrations:" -ForegroundColor White
Write-Host "   psql your_database -f src\database\migrations\004_add_agent_tables.sql" -ForegroundColor Cyan
Write-Host "4. Start the agent:" -ForegroundColor White
Write-Host "   npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "For detailed instructions, see:" -ForegroundColor Yellow
Write-Host "- QUICK-START-EXECUTION.md" -ForegroundColor Cyan
Write-Host "- SETUP-GUIDE.md" -ForegroundColor Cyan
Write-Host ""

# Made with Bob
