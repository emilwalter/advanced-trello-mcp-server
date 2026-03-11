# Deploy trello-mcp-server to GCP Cloud Run
# SECURITY: Never commit secrets. Set env vars or use a .env file (not committed).
# Required: gcloud CLI installed and authenticated (gcloud auth login)

$ErrorActionPreference = "Stop"

# Load .env if it exists (so you can add MCP_ACCESS_TOKEN there)
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $eq = $line.IndexOf('=')
            if ($eq -gt 0) {
                $key = $line.Substring(0, $eq).Trim()
                $val = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
                [Environment]::SetEnvironmentVariable($key, $val, 'Process')
            }
        }
    }
}

$projectID = "milfordsway"
$cloudbuildConfigFile = "cloudbuild.yaml"

# Required environment variables
$requiredVars = @("TRELLO_API_KEY", "TRELLO_API_TOKEN")
$missing = @()
foreach ($var in $requiredVars) {
    if (-not (Get-ChildItem "Env:$var" -ErrorAction SilentlyContinue).Value) {
        $missing += $var
    }
}

if ($missing.Count -gt 0) {
    Write-Host "ERROR: Missing required environment variables:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" }
    Write-Host ""
    Write-Host "Set them before running, e.g.:" -ForegroundColor Yellow
    Write-Host '  $env:TRELLO_API_KEY = "your_key"'
    Write-Host '  $env:TRELLO_API_TOKEN = "your_token"'
    exit 1
}

# Set the GCP project
Write-Host "Setting the GCP project to $projectID..." -ForegroundColor Cyan
gcloud config set project $projectID

# Optional: restrict access to your team (set MCP_ACCESS_TOKEN to require Bearer token)
$subs = "_TRELLO_API_KEY=$env:TRELLO_API_KEY,_TRELLO_API_TOKEN=$env:TRELLO_API_TOKEN"
if ($env:MCP_ACCESS_TOKEN) {
    $subs += ",_MCP_ACCESS_TOKEN=$env:MCP_ACCESS_TOKEN"
    Write-Host "MCP_ACCESS_TOKEN set - only users with the token can connect." -ForegroundColor Yellow
}

# Submit the Cloud Build
Write-Host "Submitting Cloud Build..." -ForegroundColor Cyan
gcloud builds submit --config=$cloudbuildConfigFile --substitutions=$subs

if ($LASTEXITCODE -ne 0) {
    Write-Host "Cloud Build failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Deployment completed successfully." -ForegroundColor Green
