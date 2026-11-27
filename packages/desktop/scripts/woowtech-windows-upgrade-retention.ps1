# Upgrade data retention on a disposable Windows runner: install a published build, let it save
# data, install another build over it, and check that the data survived (e2e/upgrade-retention.js).
# It builds, signs and publishes nothing.
#
# The new build is, in order of precedence: -CandidateApp (an already unpacked app, run in place),
# -CandidateRun/-CandidateArtifact (a signed Setup, or an unpacked win-unpacked folder, from a
# workflow run of this repository), or the published -ToVersion.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Brand,
  [Parameter(Mandatory=$true)][string]$AppName,
  [Parameter(Mandatory=$true)][string]$ArtifactPrefix,
  [Parameter(Mandatory=$true)][string]$ReleasesRepo,
  [Parameter(Mandatory=$true)][string]$FromVersion,
  [Parameter(Mandatory=$true)][string]$ToVersion,
  [string]$CandidateApp = '',
  [string]$CandidateRun = '',
  [string]$CandidateArtifact = '',
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$DiagnosticsDir
)
$ErrorActionPreference = 'Stop'
$Publisher = 'WOOW TECH CO., LTD.'
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).ProviderPath
New-Item -ItemType Directory -Path $DiagnosticsDir -Force | Out-Null
$work = Join-Path $env:RUNNER_TEMP 'upgrade-retention'
$state = Join-Path $work 'state'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$installDir = Join-Path $env:LOCALAPPDATA "Programs\$AppName"
$check = Join-Path $SourceRoot 'packages/desktop/e2e/upgrade-retention.js'
$env:PASEO_SMOKE_BRAND = $Brand
$script:appDirs = @($installDir)

function Get-PublishedSetup([string]$version) {
  $dir = Join-Path $work "published-$version"
  & gh release download "v$version" --repo $ReleasesRepo --pattern "$ArtifactPrefix-Setup-$version-x64.exe" --dir $dir --clobber
  if ($LASTEXITCODE -ne 0) { throw "Could not download $version from $ReleasesRepo" }
  $setups = @(Get-ChildItem -LiteralPath $dir -Filter '*-Setup-*-x64.exe')
  if ($setups.Count -ne 1) { throw "Expected one $version installer, found $($setups.Count)" }
  return $setups[0].FullName
}
function Assert-Signed([string]$path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -cne $Publisher) {
    throw "$path is not validly signed by $Publisher (status $($signature.Status))"
  }
  Write-Host "Signature valid ($Publisher): $(Split-Path -Leaf $path)"
}
function Stop-AppProcesses {
  # An installer cannot replace files a running app holds, and the app leaves its daemon behind.
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $path = $_.Path
    $path -and @($script:appDirs | Where-Object { $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
  } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}
function Install-Setup([string]$setup) {
  Stop-AppProcesses
  $process = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer exited $($process.ExitCode)" }
  # The installer starts the app when it finishes.
  Stop-AppProcesses
}
function Get-InstalledVersion {
  $exe = Join-Path $installDir "$AppName.exe"
  if (-not (Test-Path -LiteralPath $exe)) { throw "Missing $exe" }
  return ([Diagnostics.FileVersionInfo]::GetVersionInfo($exe).FileVersion -split '\+')[0]
}
function Get-UninstallKeys {
  $root = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  return @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | Get-ItemProperty |
    Where-Object { $_.DisplayName -like "$AppName*" } | ForEach-Object { $_.PSChildName })
}
function Invoke-Check([string[]]$arguments) {
  & node $check @arguments
  if ($LASTEXITCODE -ne 0) { throw "upgrade-retention $($arguments[1]) failed with exit code $LASTEXITCODE" }
}

try {
  $previousSetup = Get-PublishedSetup $FromVersion
  Assert-Signed $previousSetup
  Install-Setup $previousSetup
  $installed = Get-InstalledVersion
  if ($installed -ne $FromVersion) { throw "Installed $installed instead of the previous build $FromVersion" }
  $keysBefore = Get-UninstallKeys
  if ($keysBefore.Count -ne 1) { throw "Expected one uninstall entry for $AppName, found $($keysBefore.Count)" }
  Write-Host "Previous build $installed installed at $installDir"
  Invoke-Check @('--phase', 'seed', '--app', $installDir, '--state', $state, '--real-dirs', '--label', $FromVersion)
  Stop-AppProcesses

  $newApp = $installDir
  if ($CandidateApp) {
    $newApp = (Resolve-Path -LiteralPath $CandidateApp).ProviderPath
    $script:appDirs += $newApp
    Write-Host "New build runs in place from $newApp"
  } elseif ($CandidateRun) {
    $candidates = Join-Path $work 'candidate'
    & gh run download $CandidateRun --repo $env:GITHUB_REPOSITORY --name $CandidateArtifact --dir $candidates
    if ($LASTEXITCODE -ne 0) { throw "Could not download $CandidateArtifact from run $CandidateRun" }
    $setups = @(Get-ChildItem -LiteralPath $candidates -Recurse -Filter "$ArtifactPrefix-Setup-$ToVersion-x64.exe")
    if ($setups.Count -eq 1) {
      Assert-Signed $setups[0].FullName
      Install-Setup $setups[0].FullName
    } else {
      $unpacked = @(Get-ChildItem -LiteralPath $candidates -Recurse -Directory -Filter 'win-unpacked')
      if ($unpacked.Count -ne 1) { throw "Expected one Setup or one win-unpacked folder in $CandidateArtifact" }
      $newApp = $unpacked[0].FullName
      $script:appDirs += $newApp
    }
  } else {
    $toSetup = Get-PublishedSetup $ToVersion
    Assert-Signed $toSetup
    Install-Setup $toSetup
  }
  if ($newApp -eq $installDir) {
    $installed = Get-InstalledVersion
    if ($installed -ne $ToVersion) { throw "Installed $installed after the upgrade instead of $ToVersion" }
    $keysAfter = Get-UninstallKeys
    if (($keysAfter -join ',') -ne ($keysBefore -join ',')) { throw "The upgrade changed the uninstall registration: $($keysBefore -join ',') -> $($keysAfter -join ',')" }
    Write-Host "Upgraded in place to $installed; the uninstall registration is unchanged"
  }
  Invoke-Check @('--phase', 'verify', '--app', $newApp, '--state', $state, '--real-dirs', '--expect-version', $ToVersion, '--label', $FromVersion)
} finally {
  Stop-AppProcesses
  Get-ChildItem -LiteralPath $state -File -ErrorAction SilentlyContinue | Copy-Item -Destination $DiagnosticsDir
}
