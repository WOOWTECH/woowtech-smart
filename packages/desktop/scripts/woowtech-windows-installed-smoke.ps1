# Shared by Desktop Release and verification of already-signed candidate artifacts.
# Run only on a disposable Windows runner; does not build, sign or publish anything.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ReleaseDir,
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$Publisher,
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$DiagnosticsDir
)
$ErrorActionPreference = 'Stop'
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).ProviderPath
New-Item -ItemType Directory -Path $DiagnosticsDir -Force | Out-Null
$brand = node -e "process.stdout.write(JSON.stringify(require(process.argv[1]).appliedBrand()))" (Join-Path $SourceRoot 'woowtech/brands/index.cjs') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read candidate brand' }
$name = $brand.name
$check = Join-Path $PSScriptRoot 'woowtech-windows-signatures.ps1'
$release = (Resolve-Path -LiteralPath $ReleaseDir).ProviderPath
& $check -Path $release -RequireSigned -Publisher $Publisher
$setups = @(Get-ChildItem -LiteralPath $release -Filter "$($brand.desktop.artifactPrefix)-Setup-$Version-x64.exe")
if ($setups.Count -ne 1) { throw "Expected exactly one branded x64 installer for $Version in $release" }
$setup = $setups[0]
# The artifact name is not sufficient: verify the actual executable before installing.
$signature = Get-AuthenticodeSignature -LiteralPath $setup.FullName
if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate -or
    $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -cne $Publisher) {
  throw 'Installer signature or publisher mismatch'
}
$info = [Diagnostics.FileVersionInfo]::GetVersionInfo($setup.FullName)
if (($info.ProductVersion -split '\+')[0] -ne $Version -or $info.ProductName -ne $name) {
  throw "Installer product/version mismatch: $($info.ProductName) $($info.ProductVersion)"
}
$script:uninstallKey = $null
function Install-Candidate([string]$arguments) {
  $process = Start-Process -FilePath $setup.FullName -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer exited $($process.ExitCode)" }
}
function Resolve-CandidateInstall([string]$phase) {
  $uninstallRoot = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  $entries = @(Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue |
    Get-ItemProperty | Where-Object { $_.DisplayName -eq "$name $Version" })
  $evidence = @($entries | ForEach-Object {
    $location = Get-ItemPropertyValue -LiteralPath "Registry::HKEY_CURRENT_USER\Software\$($_.PSChildName)" -Name InstallLocation -ErrorAction SilentlyContinue
    [pscustomobject]@{ Key = $_.PSChildName; DisplayName = $_.DisplayName; DisplayVersion = $_.DisplayVersion; InstallLocation = $location; UninstallString = $_.UninstallString }
  })
  $diagnostics = $DiagnosticsDir
  New-Item -ItemType Directory -Path $diagnostics -Force | Out-Null
  ConvertTo-Json -InputObject $evidence -Depth 3 | Set-Content -LiteralPath (Join-Path $diagnostics "installer-registry-$phase.json")
  if ($evidence.Count -ne 1) { throw "Expected one HKCU uninstall entry for $name $Version; found $($evidence.Count)" }
  $entry = $evidence[0]
  if ($script:uninstallKey -and $script:uninstallKey -ne $entry.Key) { throw 'Update changed the uninstall key' }
  $script:uninstallKey = $entry.Key
  if ($entry.DisplayVersion -ne $Version) { throw 'Registered version differs from candidate' }
  if (Test-Path -LiteralPath "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($entry.Key)") { throw 'Candidate registered a machine-wide installation' }
  $location = $entry.InstallLocation
  if (-not $location -or -not [IO.Path]::IsPathRooted($location)) { throw 'Missing absolute HKCU InstallLocation' }
  foreach ($file in @("$name.exe", "Uninstall $name.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $location $file) -PathType Leaf)) { throw "Registered installation is missing $file at $location" }
  }
  $expectedUninstall = '"' + (Join-Path $location "Uninstall $name.exe") + '" /currentuser'
  if ($entry.UninstallString -ne $expectedUninstall) { throw 'Uninstall registration does not match the per-user installed executable' }
  Write-Host "Verified $phase HKCU installation: $location"
  return $location
}
function Test-InstalledLaunch([string]$location, [string]$phase) {
  $exe = Join-Path $location "$name.exe"
  $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
  if (($info.ProductVersion -split '\+')[0] -ne $Version -or $info.ProductName -ne $name) {
    throw 'Installed executable product/version mismatch'
  }
  $phaseDir = Join-Path $DiagnosticsDir "installed-$phase"
  New-Item -ItemType Directory -Path $phaseDir -Force | Out-Null
  [pscustomobject]@{ phase=$phase; executable=$exe; version=$info.ProductVersion; sha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $phaseDir 'launch-target.json')
  $previous = $env:PASEO_DESKTOP_SMOKE_ARTIFACT_DIR
  try {
    $env:PASEO_DESKTOP_SMOKE_ARTIFACT_DIR = $phaseDir
    # This existing harness isolates user data, daemon home and dynamic loopback
    # ports, validates renderer/preload/daemon/CLI/terminal, then stops its processes.
    & node (Join-Path $SourceRoot 'packages/desktop/e2e/packaged-app-smoke.js') --app $location 2>&1 |
      Tee-Object -FilePath (Join-Path $phaseDir 'smoke-console.log') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Installed $phase smoke failed: $LASTEXITCODE" }
  } finally { $env:PASEO_DESKTOP_SMOKE_ARTIFACT_DIR = $previous }
}
Install-Candidate '/S'
$dir = Resolve-CandidateInstall 'fresh'
$expectedFreshDir = Join-Path $env:LOCALAPPDATA "Programs\$name"
if ($dir -ne $expectedFreshDir) { throw "Fresh install used $dir instead of the branded folder $expectedFreshDir" }
& $check -Path $dir -RequireSigned -Publisher $Publisher
Test-InstalledLaunch $dir 'fresh'
# Reinstall via the updater's silent path. User data must survive both that and uninstall.
$dataDirs = @(
  (Join-Path $env:APPDATA $name),
  (Join-Path $env:USERPROFILE ($brand.homeDir -replace '^~/', ''))
)
$sentinels = @($dataDirs | ForEach-Object {
  New-Item -ItemType Directory -Path $_ -Force | Out-Null
  $sentinel = Join-Path $_ 'installer-ci-preserve.txt'
  Set-Content -LiteralPath $sentinel -Value 'preserve across update and uninstall'
  $sentinel
})
function Assert-UserData {
  foreach ($sentinel in $sentinels) {
    if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne 'preserve across update and uninstall') {
      throw "Installer changed user data: $sentinel"
    }
  }
}
Install-Candidate '/S --updated'
$updatedDir = Resolve-CandidateInstall 'updated'
if ($updatedDir -ne $dir) { throw 'Silent update changed InstallLocation' }
Assert-UserData
& $check -Path $dir -RequireSigned -Publisher $Publisher
Test-InstalledLaunch $updatedDir 'updated'
# _?= keeps the uninstaller where it is, so -Wait waits for it; it must come last.
$uninstall = Start-Process -FilePath (Join-Path $dir "Uninstall $name.exe") -ArgumentList "/currentuser /S _?=$dir" -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited $($uninstall.ExitCode)" }
if (Test-Path -LiteralPath (Join-Path $dir "$name.exe")) { throw 'Uninstalling left the app behind' }
$registryPaths = @(
  "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\$script:uninstallKey",
  "Registry::HKEY_CURRENT_USER\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$script:uninstallKey",
  "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\$script:uninstallKey",
  "Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$script:uninstallKey"
)
$cleanup = @($registryPaths | ForEach-Object { [pscustomobject]@{ path=$_; exists=(Test-Path -LiteralPath $_) } })
ConvertTo-Json -InputObject $cleanup | Set-Content -LiteralPath (Join-Path $DiagnosticsDir 'uninstall-registry-cleanup.json')
if (@($cleanup | Where-Object exists).Count -ne 0) { throw 'Uninstalling left the branded uninstall registry key behind' }
Assert-UserData
$sentinels | ForEach-Object { Remove-Item -LiteralPath $_ }
