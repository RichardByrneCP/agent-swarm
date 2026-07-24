# Install agent-swarm as a global command and install its personal skill (Windows / PowerShell).
# Safe to re-run. Usage:  powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'

$ToolDir = $PSScriptRoot
$SkillSrc = Join-Path $ToolDir 'skill\SKILL.md'
$SkillDestDir = Join-Path $env:USERPROFILE '.cursor\skills\agent-swarm'

Write-Host 'agent-swarm installer (Windows)'
Write-Host "  tool dir: $ToolDir"

# 1. Node version check (@cursor/sdk requires >= 22.13)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'node is not installed. Install Node >= 22.13 (e.g. via nvm-windows or the official installer).'
}
$NodeVer = (node -p 'process.versions.node').Trim()
$parts = $NodeVer.Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
  Write-Error "Node $NodeVer found, but >= 22.13 is required (@cursor/sdk). Upgrade Node and re-run."
}
Write-Host "  node:     $NodeVer (ok)"

# 2. Install dependencies
Write-Host 'Installing dependencies...'
Push-Location $ToolDir
try {
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }
  # 3. Link the global 'agent-swarm' command
  Write-Host "Linking global command 'agent-swarm'..."
  npm link
  if ($LASTEXITCODE -ne 0) {
    throw "npm link failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

# 4. Install the personal skill
Write-Host "Installing personal skill to $SkillDestDir..."
New-Item -ItemType Directory -Force -Path $SkillDestDir | Out-Null
Copy-Item -Force $SkillSrc (Join-Path $SkillDestDir 'SKILL.md')

Write-Host ''
Write-Host 'Done.'
Write-Host '  Try:  agent-swarm --version'
Write-Host '        agent-swarm "<your goal>" --dry-run'
Write-Host ''
if (-not $env:CURSOR_API_KEY -and -not (Test-Path (Join-Path $ToolDir '.env'))) {
  Write-Host "Next: set CURSOR_API_KEY — copy $ToolDir\.env.example to $ToolDir\.env (loaded as a fallback from any cwd), place a .env in the target repo, or setx CURSOR_API_KEY `"...`"."
}
