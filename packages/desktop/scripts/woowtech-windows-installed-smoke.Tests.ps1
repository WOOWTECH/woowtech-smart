# Exercise the production metadata assertion without installing or launching an app.
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'woowtech-windows-installed-smoke.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$function = $ast.Find({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-InstalledExecutableMetadata'
}, $true)
if (-not $function) { throw 'Production metadata assertion not found' }
. ([scriptblock]::Create($function.Extent.Text))
$temp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $exe = Join-Path $temp 'fixture.exe'
  Set-Content -LiteralPath $exe -Value 'metadata unit test fixture; not a PE'
  $Version = '0.10.2-rc.1'
  $cases = @(
    @{ Name='Smart RC'; Brand='woowtech smart'; Product='woowtech smart'; File='0.10.2-rc.1'; Numeric='0.10.2.0'; Valid=$true },
    @{ Name='Apporo RC'; Brand='Apporo smart'; Product='Apporo smart'; File='0.10.2-rc.1'; Numeric='0.10.2.0'; Valid=$true },
    @{ Name='Wrong RC'; Brand='woowtech smart'; Product='woowtech smart'; File='0.10.2-rc.2'; Numeric='0.10.2.0'; Valid=$false },
    @{ Name='Missing RC'; Brand='woowtech smart'; Product='woowtech smart'; File='0.10.2'; Numeric='0.10.2.0'; Valid=$false },
    @{ Name='Wrong core'; Brand='woowtech smart'; Product='woowtech smart'; File='0.10.2-rc.1'; Numeric='0.10.3.0'; Valid=$false },
    @{ Name='Wrong brand'; Brand='woowtech smart'; Product='Apporo smart'; File='0.10.2-rc.1'; Numeric='0.10.2.0'; Valid=$false },
    @{ Name='Missing version'; Brand='woowtech smart'; Product='woowtech smart'; File=$null; Numeric='0.10.2.0'; Valid=$false }
  )
  foreach ($case in $cases) {
    $name = $case.Brand
    $info = [pscustomobject]@{ ProductName=$case.Product; FileVersion=$case.File; ProductVersion=$case.Numeric }
    $failure = $null
    try { Assert-InstalledExecutableMetadata $info $exe $temp } catch { $failure = $_ }
    if (($null -eq $failure) -ne $case.Valid) { throw "Unexpected result for $($case.Name): $failure" }
    $evidence = Get-Content -LiteralPath (Join-Path $temp 'launch-target.json') -Raw | ConvertFrom-Json
    if ($evidence.fileVersion -cne $case.File -or $evidence.productVersion -cne $case.Numeric -or
        $evidence.productName -cne $case.Product -or $evidence.expectedFileVersion -cne $Version -or
        $evidence.sha256 -cne (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash) {
      throw "Missing actual/expected metadata evidence for $($case.Name)"
    }
    if ($failure -and $failure.ToString() -notmatch 'Installed executable product/version mismatch:') {
      throw "Unexpected failure for $($case.Name): $failure"
    }
    Write-Host "PASS $($case.Name)"
  }
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
