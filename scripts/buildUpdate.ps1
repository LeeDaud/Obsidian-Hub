param([switch]$Debug)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $projectDirectory
$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
try {
    if (!$env:TAURI_SIGNING_PRIVATE_KEY) {
        $signingKeyPath = Join-Path $env:USERPROFILE '.tauri/obsidian-hub-updater.key'
        if (!(Test-Path -LiteralPath $signingKeyPath)) {
            throw 'Updater signing key not found. See docs/hub-updates.md.'
        }
        $env:TAURI_SIGNING_PRIVATE_KEY = $signingKeyPath
    }
    if ($Debug) {
        pnpm tauri build --debug --ci
    } else {
        pnpm tauri build --ci
    }
    if ($LASTEXITCODE -ne 0) { throw 'Signed application build failed.' }
    $buildProfile = if ($Debug) { 'debug' } else { 'release' }
    node scripts/prepareUpdate.mjs $buildProfile
    if ($LASTEXITCODE -ne 0) { throw 'Update manifest generation failed.' }
} finally {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
    Pop-Location
}
