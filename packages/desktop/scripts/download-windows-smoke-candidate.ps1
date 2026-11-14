# Only the reviewed, successful Desktop Release artifacts in the adjacent allowlist.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('woowtech', 'apporo')][string]$Candidate,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-smoke-candidates.json') -Raw | ConvertFrom-Json
$pin = $config.$Candidate
$repo = 'WOOWTECH/woowtech-smart'
$headers = @{ Authorization="Bearer $env:GH_TOKEN"; Accept='application/vnd.github+json'; 'X-GitHub-Api-Version'='2022-11-28' }
$base = "https://api.github.com/repos/$repo/actions"
$run = Invoke-RestMethod -Headers $headers -Uri "$base/runs/$($pin.run)"
if ($run.status -ne 'completed' -or $run.conclusion -ne 'success' -or
    $run.path -ne '.github/workflows/desktop-release.yml' -or $run.name -ne 'Desktop Release' -or
    $run.event -ne 'workflow_dispatch' -or $run.run_attempt -ne 1 -or
    $run.head_sha -cne $pin.source -or $run.repository.full_name -cne $repo) {
  throw 'Candidate run does not match the reviewed successful Desktop Release'
}
$artifact = Invoke-RestMethod -Headers $headers -Uri "$base/artifacts/$($pin.artifact)"
if ($artifact.name -ne 'desktop-windows' -or $artifact.expired -or
    [string]$artifact.workflow_run.id -ne $pin.run -or $artifact.workflow_run.head_sha -cne $pin.source -or
    $artifact.digest -cne "sha256:$($pin.digest)") {
  throw 'Candidate artifact identity, source or digest does not match the allowlist'
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$zip = Join-Path $Destination 'candidate.zip'
Invoke-WebRequest -Headers $headers -Uri "$base/artifacts/$($pin.artifact)/zip" -OutFile $zip
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pin.digest) {
  throw 'Downloaded artifact archive digest mismatch'
}
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $Destination 'release')
[pscustomobject]@{ repository=$repo; run=$pin.run; source=$pin.source; artifact=$pin.artifact; sha256=$pin.digest; version=$pin.version; brand=$Candidate } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination 'provenance.json')
"source=$($pin.source)" >> $env:GITHUB_OUTPUT
"version=$($pin.version)" >> $env:GITHUB_OUTPUT
