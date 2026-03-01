Add-Type -AssemblyName System.IO.Compression.FileSystem

# Configuration
$targets = @("scripts", "node_modules", ".env", "package.json", "server.js", "start.bat")
$zipName = "Build.zip"
$tempDir = "temp_build_folder"
$destinationFolder = "LocalMultiplayerAgent"
$finalPath = Join-Path $destinationFolder $zipName

# Clean previous temporary builds
if (Test-Path $zipName) { Remove-Item $zipName -Force }
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }

# Create staging area and copy files
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
foreach ($item in $targets) {
    if (Test-Path $item) {
        Copy-Item -Path $item -Destination "$tempDir\" -Recurse -Force
    }
}

# Compress the folder using Fastest level for speed
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    (Resolve-Path $tempDir).Path, 
    (Join-Path (Get-Location).Path $zipName), 
    [System.IO.Compression.CompressionLevel]::Fastest, 
    $false
)

# Move to destination and replace existing file
if (Test-Path $destinationFolder) {
    Move-Item -Path $zipName -Destination $finalPath -Force
}

# Cleanup
Remove-Item -Recurse -Force $tempDir