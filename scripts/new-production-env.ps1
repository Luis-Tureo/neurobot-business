[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$Destination,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$templatePath = Join-Path $repositoryRoot 'infra\azure\neurobot.production.env.example'
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$repositoryPath = [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') + '\'

if ($destinationPath.StartsWith($repositoryPath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'El archivo de secretos debe permanecer fuera del repositorio.'
}
if ((Test-Path -LiteralPath $destinationPath) -and -not $Force) {
  throw "El archivo ya existe: $destinationPath. Use -Force solo si desea reemplazarlo."
}

function New-RandomSecret([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$content = [System.IO.File]::ReadAllText($templatePath)
$generatedValues = @{
  ANONYMIZATION_SECRET = New-RandomSecret 48
  PANEL_SESSION_SECRET = New-RandomSecret 48
  PANEL_INITIAL_PASSWORD = New-RandomSecret 24
  APP_ENCRYPTION_KEY = New-RandomSecret 32
  META_WEBHOOK_VERIFY_TOKEN = New-RandomSecret 32
}
foreach ($entry in $generatedValues.GetEnumerator()) {
  $escapedName = [regex]::Escape($entry.Key)
  $content = [regex]::Replace(
    $content,
    "(?m)^${escapedName}=.*$",
    "$($entry.Key)=$($entry.Value)"
  )
}

$parentDirectory = Split-Path -Parent $destinationPath
[System.IO.Directory]::CreateDirectory($parentDirectory) | Out-Null
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($destinationPath, $content.Replace("`r`n", "`n"), $utf8WithoutBom)

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $currentIdentity,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  [System.Security.AccessControl.AccessControlType]::Allow
)
$accessControl = New-Object System.Security.AccessControl.FileSecurity
$accessControl.SetAccessRuleProtection($true, $false)
$accessControl.AddAccessRule($accessRule)
[System.IO.File]::SetAccessControl($destinationPath, $accessControl)

Write-Host "Archivo de producción creado fuera del repositorio: $destinationPath"
Write-Host 'Se generaron los secretos internos. Faltan solo credenciales externas de Meta y Groq.'
Write-Host 'Variables pendientes: META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_WABA_ID, META_APP_SECRET, GROQ_API_KEY.'
