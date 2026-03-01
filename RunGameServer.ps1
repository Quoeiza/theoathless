# Get the root directory (E:\The Oathless)
$ProjectRoot = $PSScriptRoot
$AgentDir = Join-Path $ProjectRoot "LocalMultiplayerAgent"

# Define paths relative to the Agent Directory
$SettingsFile = Join-Path $AgentDir "MultiplayerSettings.json"
$BuildFile = Join-Path $AgentDir "Build.zip"
$OutputDir = Join-Path $AgentDir "Output"

# 1. Validation
if (-not (Test-Path $AgentDir)) {
    Write-Error "LocalMultiplayerAgent folder not found in $ProjectRoot"
    exit
}

if (-not (Test-Path $BuildFile)) {
    Write-Warning "Build.zip not found in $AgentDir."
    Write-Warning "Please ensure you have zipped your server files into '$BuildFile'."
    exit
}

# 2. Clean previous Output to prevent file locks
if (Test-Path $OutputDir) {
    Write-Host "Cleaning old Output folder..." -ForegroundColor Gray
    Remove-Item -Path $OutputDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Ensure Output folder exists (Agent requires it to exist)
New-Item -Path $OutputDir -ItemType Directory -Force | Out-Null

# 3. Update Configuration with Absolute Paths
Write-Host "Configuring Agent..." -ForegroundColor Cyan
try {
    $JsonContent = Get-Content $SettingsFile | Out-String | ConvertFrom-Json
} catch {
    Write-Error "Failed to read MultiplayerSettings.json"
    exit
}

# Inject absolute paths (Fixes the DirectoryNotFoundException)
$JsonContent.OutputFolder = $OutputDir
$JsonContent.AssetDetails[0].LocalFilePath = $BuildFile

# Save the updated JSON
$JsonContent | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile

# 4. Run the Agent
Write-Host "Starting LocalMultiplayerAgent..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Gray

# Change directory to AgentDir so it can find its own DLLs/Config
Set-Location $AgentDir
& ".\LocalMultiplayerAgent.exe"
