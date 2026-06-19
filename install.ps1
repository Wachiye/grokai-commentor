# GrokAI Extension - Quick Install Helper
$extPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$chrome = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host ""
Write-Host "GrokAI Extension Installer" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Extension folder: $extPath"
Write-Host ""

if ($chrome) {
  Start-Process $chrome "chrome://extensions"
  Start-Sleep -Milliseconds 800
}

explorer.exe $extPath
Set-Clipboard -Value $extPath

Write-Host "Steps:" -ForegroundColor Yellow
Write-Host "  1. Chrome extensions page should be open"
Write-Host "  2. Enable 'Developer mode' (top right)"
Write-Host "  3. Click 'Load unpacked'"
Write-Host "  4. Select: $extPath"
Write-Host "  5. Open extension Settings and add your xAI API key"
Write-Host ""
Write-Host "Path copied to clipboard." -ForegroundColor Green