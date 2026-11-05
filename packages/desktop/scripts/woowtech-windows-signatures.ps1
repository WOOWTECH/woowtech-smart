# woowtech smart: lists the Authenticode signature of every .exe, .dll and .node file under the
# given folders (woowtech/README.md §31, plan D8). With -RequireSigned it fails unless each one is
# validly signed and timestamped, by Microsoft or by -Publisher. The release job runs it after
# electron-builder, because Smart App Control blocks any module that loads without a valid
# signature; on the test PC, point it at the installed app to see what Smart App Control sees.
#   woowtech-windows-signatures.ps1 -Path packages\desktop\release
#   woowtech-windows-signatures.ps1 -Path packages\desktop\release -RequireSigned -Publisher 'WOOW TECH CO., LTD.'
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$Path,
  [switch]$RequireSigned,
  # The certificate's common name. Without it, -RequireSigned accepts any valid signer.
  [string]$Publisher = ''
)
$ErrorActionPreference = 'Stop'
$extensions = @('.exe', '.dll', '.node')
$rows = @(foreach ($folder in $Path) {
    $root = (Resolve-Path -LiteralPath $folder).ProviderPath
    Get-ChildItem -LiteralPath $root -Recurse -File |
      Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
      ForEach-Object {
        $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
        $certificate = $signature.SignerCertificate
        [pscustomobject]@{
          Status      = [string]$signature.Status
          Timestamped = $null -ne $signature.TimeStamperCertificate
          Signer      = if ($certificate) { $certificate.GetNameInfo('SimpleName', $false) } else { '' }
          File        = $_.FullName.Substring($root.Length).TrimStart('\', '/')
        }
      }
  })
if ($rows.Count -eq 0) {
  throw "No .exe, .dll or .node files under $($Path -join ', ')"
}
$rows | Sort-Object File | Format-Table -AutoSize | Out-String -Width 400 | Write-Output
if ($RequireSigned) {
  # Microsoft signs the files it ships with two names: conpty.dll and OpenConsole.exe are "Microsoft
  # Corporation", Electron's d3dcompiler_47.dll and dxil.dll are "Microsoft Windows". A rehearsal on a
  # GitHub-hosted Windows machine (2026-11-06) failed on the second name.
  $signers = @('Microsoft Corporation', 'Microsoft Windows')
  if ($Publisher) { $signers += $Publisher }
  $failed = @($rows | Where-Object {
      $_.Status -ne 'Valid' -or -not $_.Timestamped -or ($Publisher -and $signers -notcontains $_.Signer)
    })
  if ($failed.Count -gt 0) {
    $files = ($failed | ForEach-Object { $_.File }) -join ', '
    throw "Not signed and timestamped by $($signers -join ' or '): $files"
  }
  "All $($rows.Count) files are signed and timestamped."
}
