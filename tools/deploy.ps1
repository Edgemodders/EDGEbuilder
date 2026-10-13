<#
.SYNOPSIS
  Copies the EDGEbuilder package into the game, as a REDnode package.

.DESCRIPTION
  Mirrors edgebuilder/ into <game>\red4ext\plugins\REDnode\apps\edgebuilder.
  Deploy REDnode first, with its own tools\deploy-native.ps1. Close the game first.
  Players will install EDGEbuilder with REDdeck instead; this script is for development.

.EXAMPLE
  .\tools\deploy.ps1 -GameDir 'E:\SteamLibrary\steamapps\common\Cyberpunk 2077'
#>
param(
    [string] $GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$package = Join-Path $repo 'edgebuilder'
$apps = Join-Path $GameDir 'red4ext\plugins\REDnode\apps'

if (-not (Test-Path $apps)) { throw "REDnode's apps folder is not at $apps. Deploy REDnode first." }

$target = Join-Path $apps 'edgebuilder'
robocopy $package $target /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying failed (robocopy $LASTEXITCODE)." }
Write-Output "Deployed EDGEbuilder to $target"
exit 0 # robocopy leaves 1 for "files copied"
