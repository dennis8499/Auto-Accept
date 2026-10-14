param(
    [string]$Scenario = 'command',
    [string]$TestId = 'test',
    [int]$TimeoutMs = 4000
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$fixtureRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$prompts = Get-Content -LiteralPath (Join-Path $fixtureRoot '.cache\integration\prompts.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$responses = [Collections.Generic.List[string]]::new()
foreach ($prompt in @($prompts.$Scenario)) {
    # A resolution and the next card may be coalesced into the same output chunk.
    $prefix = if ($responses.Count -gt 0) { $prompts.working } else { '' }
    [Console]::Write($prefix + $prompt)
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
    $responses.Add($response)
}
[Console]::Write([Environment]::NewLine + 'SMOKE_RESULT:' + $TestId + ':' + ($responses -join '') + [Environment]::NewLine)
