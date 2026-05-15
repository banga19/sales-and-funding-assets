# Sokogate Sales & Funding Agent - Windows Start Script
# Quick start script for Windows PowerShell

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Starting Sokogate Sales Agent" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (!(Test-Path ".env")) {
    Write-Host "✗ .env file not found!" -ForegroundColor Red
    Write-Host "  Please run setup-windows.ps1 first" -ForegroundColor Yellow
    exit 1
}

# Check if dist folder exists
if (!(Test-Path "dist")) {
    Write-Host "✗ dist/ folder not found!" -ForegroundColor Red
    Write-Host "  Running build..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Build failed" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✓ Starting agent..." -ForegroundColor Green
Write-Host ""
Write-Host "Agent will be available at: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Health check: http://localhost:3000/api/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the agent" -ForegroundColor Yellow
Write-Host ""

# Start the agent
npm run dev

# Made with Bob
