<#
.SYNOPSIS
  Zips the EDGEbuilder package for players: dist\edgebuilder-<version>.zip.

.DESCRIPTION
  The zip holds the edgebuilder\ folder with rednode-app.json inside, which EDGEdeck (0.20.0 and
  later) recognises as a REDnode package and deploys into the game's REDnode apps folder.
  Run npm run build first; npm run package does both.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $repo 'edgebuilder\rednode-app.json') -Raw | ConvertFrom-Json
$out = Join-Path $repo "dist\edgebuilder-$($manifest.version).zip"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
if (Test-Path $out) { Remove-Item $out }
Compress-Archive -Path (Join-Path $repo 'edgebuilder') -DestinationPath $out
Write-Output "Packaged $out"
