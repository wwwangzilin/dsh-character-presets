# Luna preset installer for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/wwwangzilin/dsh-character-presets/main/install.ps1 | iex
#   # or
#   .\install.ps1
#
# Environment overrides:
#   DSH_HOME          DSH home directory (default %USERPROFILE%\.dsh)
#   DSH_PRESET_DIR    where the plugin package is copied (default $DSH_HOME\presets\luna)
#   DSH_PRESET_REPO   source repository (default this repo on GitHub)
#   DSH_PRESET_REF    branch or tag (default main)
#
# Since DSH 0.2 an agent preset is a bundle patch, not a directory under
# .agent-presets: this script fetches the plugin package and hands it to
# `dsh plugin add`, the official install path.
#
# Output is intentionally ASCII: Windows PowerShell 5.1 decodes BOM-less
# script files with the ANSI code page, so non-ASCII text can garble.

$ErrorActionPreference = 'Stop'

$Repo = if ($env:DSH_PRESET_REPO) { $env:DSH_PRESET_REPO } else { 'https://github.com/wwwangzilin/dsh-character-presets.git' }
$Ref = if ($env:DSH_PRESET_REF) { $env:DSH_PRESET_REF } else { 'main' }
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$Target = if ($env:DSH_PRESET_DIR) { $env:DSH_PRESET_DIR } else { Join-Path (Join-Path $DshHome 'presets') 'luna' }

Write-Host 'Luna preset - install'
Write-Host "  repo    : $Repo ($Ref)"
Write-Host "  target  : $Target"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'git not found on PATH - install git first'
}

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-preset-" + [guid]::NewGuid().ToString('N'))
git clone --depth 1 --branch $Ref $Repo $Tmp
if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }

$Manifest = Join-Path $Tmp 'package.json'
if (-not (Test-Path $Manifest)) { throw "package.json missing in $Repo ($Ref)" }
$Pkg = Get-Content $Manifest -Raw | ConvertFrom-Json
if (-not $Pkg.dsh.bundle.patch) { throw "$Ref is not an installable bundle (package.json has no dsh.bundle)" }

New-Item -ItemType Directory -Path (Split-Path $Target -Parent) -Force | Out-Null
if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
Copy-Item -Recurse -Force $Tmp $Target
Remove-Item -Recurse -Force (Join-Path $Target '.git') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "OK - plugin package at $Target" -ForegroundColor Green
Write-Host "  preset: $($Pkg.dsh.preset.name)"
Write-Host ''
Write-Host 'Installing into the current profile with the official CLI...'
dsh plugin add $Target
if ($LASTEXITCODE -ne 0) {
    throw "dsh plugin add failed - run it yourself: dsh plugin add `"$Target`""
}

Write-Host ''
Write-Host 'Next:'
Write-Host '  1. restart DSH'
Write-Host '  2. new session -> pick the preset in the selector'
Write-Host '     (or set it as default under Settings -> Agent presets)'
Write-Host ''
Write-Host 'Memory file: $DSH_HOME\.luna-heart.json - delete it to reset the bond.'
