# Deploy trello-mcp-server to GCP Cloud Run
# SECURITY: Never commit secrets. Set env vars or use a .env file (not committed).
# Required: gcloud CLI installed and authenticated (gcloud auth login)

$ErrorActionPreference = "Stop"

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

# Submit the Cloud Build
Write-Host "Submitting Cloud Build..." -ForegroundColor Cyan
gcloud builds submit --config=$cloudbuildConfigFile `
    --substitutions="_TRELLO_API_KEY=$env:TRELLO_API_KEY",`
    "_TRELLO_API_TOKEN=$env:TRELLO_API_TOKEN"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Cloud Build failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Deployment completed successfully." -ForegroundColor Green
