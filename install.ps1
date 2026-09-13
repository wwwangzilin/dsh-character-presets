# Luna preset installer for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/wwwangzilin/dsh-character-presets/main/install.ps1 | iex
#   # or
#   .\install.ps1
#
# Environment overrides:
#   DSH_HOME          DSH home directory (default %USERPROFILE%\.dsh)
#   DSH_PRESETS_DIR   presets directory (default $DSH_HOME\.agent-presets)
#   LUNA_REPO         source repository (default this repo on GitHub)
#   LUNA_REF          branch or tag (default main)
#
# Output is intentionally ASCII: Windows PowerShell 5.1 decodes BOM-less
# script files with the ANSI code page, so non-ASCII text can garble.

$ErrorActionPreference = 'Stop'

$Repo = if ($env:LUNA_REPO) { $env:LUNA_REPO } else { 'https://github.com/wwwangzilin/dsh-character-presets.git' }
$Ref = if ($env:LUNA_REF) { $env:LUNA_REF } else { 'main' }
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$PresetsDir = if ($env:DSH_PRESETS_DIR) { $env:DSH_PRESETS_DIR } else { Join-Path $DshHome '.agent-presets' }
$Target = Join-Path $PresetsDir 'luna'

Write-Host 'Luna preset - install'
Write-Host "  repo    : $Repo ($Ref)"
Write-Host "  target  : $Target"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'git not found on PATH - install git first'
}

if ((Test-Path $Target) -and -not (Test-Path (Join-Path $Target '.git'))) {
    throw "$Target exists and is not a git checkout - move it away, or point DSH_PRESETS_DIR elsewhere"
}

New-Item -ItemType Directory -Path $PresetsDir -Force | Out-Null

if (Test-Path (Join-Path $Target '.git')) {
    Write-Host '  -> already installed, updating'
    git -C $Target fetch --depth 1 origin $Ref
    git -C $Target checkout -q $Ref 2>$null
    git -C $Target pull --ff-only origin $Ref
} else {
    git clone --depth 1 --branch $Ref $Repo $Target
}

if ((Split-Path $Target -Leaf) -ne 'luna') { throw "directory must be named 'luna' (got '$(Split-Path $Target -Leaf)')" }
foreach ($f in @('preset.yml', 'agent.cordis.yml')) {
    if (-not (Test-Path (Join-Path $Target $f))) { throw "incomplete install: $f missing" }
}

Write-Host ''
Write-Host "OK - Luna installed at $Target" -ForegroundColor Green
Write-Host ''
Write-Host 'Next:'
Write-Host '  1. restart DSH'
Write-Host '  2. new session -> pick "Luna" in the preset selector'
Write-Host '     (or set it as default under Settings -> Agent presets)'
Write-Host ''
Write-Host 'Uninstall: delete the folder above. Her memory file (.luna-heart.json)'
Write-Host 'lives in the workspace or $DSH_HOME - delete that too to reset the bond.'
