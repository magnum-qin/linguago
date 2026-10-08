param(
  [string]$Root = 'D:\linguago-runner'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentUser = $identity.Name
$secretDir = Join-Path $Root 'state\secrets'
$credentialPath = Join-Path $secretDir 'dictionary-task-credential.dpapi'
$tempPath = "$credentialPath.$PID.tmp"

New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
$userSid = $identity.User.Value
$aclRules = @(
  "*$($userSid):(OI)(CI)F",
  '*S-1-5-18:(OI)(CI)F',
  '*S-1-5-32-544:(OI)(CI)F'
)
& icacls.exe $secretDir /inheritance:r /grant:r $aclRules | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict task credential directory ACL' }

$password = Read-Host "Password for $currentUser" -AsSecureString
if (-not $password -or $password.Length -eq 0) { throw 'Password cannot be empty' }

$bstr = [IntPtr]::Zero
$plainBytes = $null
$cipherBytes = $null
try {
  Add-Type -AssemblyName System.Security
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  $plainBytes = [Text.Encoding]::UTF8.GetBytes([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))
  $cipherBytes = [Security.Cryptography.ProtectedData]::Protect(
    $plainBytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  [IO.File]::WriteAllText($tempPath, [Convert]::ToBase64String($cipherBytes), [Text.Encoding]::ASCII)
  Move-Item -LiteralPath $tempPath -Destination $credentialPath -Force
  Write-Output "Stored machine-DPAPI task credential for $currentUser in restricted runner state"
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  if ($cipherBytes) { [Array]::Clear($cipherBytes, 0, $cipherBytes.Length) }
  if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
  Remove-Variable password -ErrorAction SilentlyContinue
}
