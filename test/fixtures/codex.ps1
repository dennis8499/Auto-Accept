param(
    [string]$Scenario = 'command',
    [string]$TestId = 'test',
    [int]$TimeoutMs = 4000
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$fixtureRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$prompts = Get-Content -LiteralPath (Join-Path $fixtureRoot '.cache\integration\prompts.json') -Raw -Encoding UTF8 | ConvertFrom-Json
[Console]::Write($prompts.$Scenario)
$timer = [Diagnostics.Stopwatch]::StartNew()
$response = 'NONE'
while ($timer.ElapsedMilliseconds -lt $TimeoutMs) {
    if ([Console]::KeyAvailable) {
        $key = [Console]::ReadKey($true)
        $response = [string]$key.KeyChar
        break
    }
    Start-Sleep -Milliseconds 15
}
[Console]::Write([Environment]::NewLine + 'SMOKE_RESULT:' + $TestId + ':' + $response + [Environment]::NewLine)
