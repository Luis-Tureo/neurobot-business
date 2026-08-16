[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[0-9a-fA-F-]{36}$')]
  [string]$SubscriptionId,

  [Parameter(Mandatory)]
  [string]$EnvironmentFile,

  [Parameter(Mandatory)]
  [string]$SshPrivateKeyPath,

  [string]$SubscriptionName = 'Azure for Students',
  [string]$Location = 'chilecentral',
  [string]$ResourceGroupName = 'rg-neurobot-business-prod',
  [string]$VmName = 'vm-neurobot-business',
  [string]$VmSize = 'Standard_B2ats_v2',
  [string]$AdminUsername = 'azureadmin',
  [string]$DnsLabelPrefix,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$templatePath = Join-Path $repositoryRoot 'infra\azure\main.bicep'
$environmentPath = [System.IO.Path]::GetFullPath($EnvironmentFile)
$privateKeyPath = [System.IO.Path]::GetFullPath($SshPrivateKeyPath)
$publicKeyPath = "$privateKeyPath.pub"
$repositoryPath = [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') + '\'

function Resolve-CommandPath([string]$Name, [string[]]$Candidates = @()) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -ne $command) { return $command.Source }
  foreach ($candidate in $Candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "No se encontró la herramienta requerida: $Name."
}

$azureCli = Resolve-CommandPath 'az' @(
  'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd',
  'C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
)
$ssh = Resolve-CommandPath 'ssh'
$scp = Resolve-CommandPath 'scp'
$sshKeygen = Resolve-CommandPath 'ssh-keygen'
$tar = Resolve-CommandPath 'tar'
$npm = Resolve-CommandPath 'npm.cmd' @('C:\Program Files\nodejs\npm.cmd')
$curl = Resolve-CommandPath 'curl.exe' @('C:\Windows\System32\curl.exe')

function Invoke-AzureJson([string[]]$Arguments) {
  $raw = & $azureCli @Arguments --only-show-errors --output json
  if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI falló en la operación '$($Arguments[0..([math]::Min(2, $Arguments.Count - 1))] -join ' ')'."
  }
  if ([string]::IsNullOrWhiteSpace(($raw -join "`n"))) { return $null }
  $parsed = ($raw -join "`n") | ConvertFrom-Json
  # Windows PowerShell 5.1 preserves a root JSON array as one nested object.
  # Emit each item explicitly so list commands have the same shape in PS 5.1 and PS 7.
  if ($parsed -is [System.Array]) {
    foreach ($item in $parsed) { Write-Output $item }
    return
  }
  Write-Output $parsed
}

function Get-RetailItems([string]$Filter) {
  $encodedFilter = [uri]::EscapeDataString($Filter)
  $uri = "https://prices.azure.com/api/retail/prices?currencyCode='USD'&%24filter=$encodedFilter"
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      return @((Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 30).Items)
    } catch {
      if ($attempt -eq 6) {
        throw 'La API pública de precios no respondió después de varios reintentos. No se crearán recursos.'
      }
      $delaySeconds = [math]::Min(5 * [math]::Pow(2, $attempt - 1), 60)
      Start-Sleep -Seconds $delaySeconds
    }
  }
}

function Get-RequiredEnvironmentValues([string]$Path) {
  $values = @{}
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') {
      $values[$matches[1]] = $matches[2].Trim()
    }
  }
  return $values
}

function Assert-ProductionEnvironment([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "No existe el archivo de entorno externo: $Path"
  }
  if ($Path.StartsWith($repositoryPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'El archivo de secretos debe permanecer fuera del repositorio.'
  }
  $values = Get-RequiredEnvironmentValues $Path
  $required = @(
    'META_ACCESS_TOKEN',
    'META_PHONE_NUMBER_ID',
    'META_WABA_ID',
    'META_APP_SECRET',
    'META_WEBHOOK_VERIFY_TOKEN',
    'PANEL_SESSION_SECRET',
    'PANEL_INITIAL_PASSWORD',
    'ANONYMIZATION_SECRET',
    'GROQ_API_KEY'
  )
  $missing = @($required | Where-Object {
    -not $values.ContainsKey($_) -or
    [string]::IsNullOrWhiteSpace([string]$values[$_]) -or
    [string]$values[$_] -match '^reemplace-'
  })
  if ($missing.Count -gt 0) {
    throw "Faltan variables obligatorias en el archivo externo: $($missing -join ', ')."
  }
  if ($values['NODE_ENV'] -ne 'production') {
    throw 'NODE_ENV debe ser production en el archivo externo.'
  }
  if ($values['PANEL_HOST'] -ne '127.0.0.1') {
    throw 'PANEL_HOST debe ser 127.0.0.1; Caddy es el único punto público.'
  }
  if ($values['DATABASE_PATH'] -ne '/var/lib/neurobot/data/neurobot.db') {
    throw 'DATABASE_PATH debe apuntar al almacenamiento persistente /var/lib/neurobot/data/neurobot.db.'
  }
  if (
    $values.ContainsKey('META_WHATSAPP_ACCOUNTS_JSON') -and
    -not [string]::IsNullOrWhiteSpace([string]$values['META_WHATSAPP_ACCOUNTS_JSON'])
  ) {
    throw 'Este despliegue está fijado a una cuenta simple; META_WHATSAPP_ACCOUNTS_JSON debe permanecer vacío.'
  }
  if (
    [string]$values['META_PHONE_NUMBER_ID'] -notmatch '^\d{6,30}$' -or
    [string]$values['META_WABA_ID'] -notmatch '^\d{6,30}$'
  ) {
    throw 'META_PHONE_NUMBER_ID y META_WABA_ID deben contener entre 6 y 30 dígitos.'
  }
  return $values
}

function Get-StudentCreditBalance([string]$ExpectedSubscriptionId) {
  $billingAccounts = @(Invoke-AzureJson @('billing', 'account', 'list'))
  foreach ($billingAccount in $billingAccounts) {
    $subscriptions = @(Invoke-AzureJson @(
      'billing', 'subscription', 'list',
      '--account-name', [string]$billingAccount.name
    ))
    $billingSubscription = $subscriptions | Where-Object {
      $_.subscriptionId -eq $ExpectedSubscriptionId
    } | Select-Object -First 1
    if ($null -eq $billingSubscription -or [string]::IsNullOrWhiteSpace($billingSubscription.billingProfileId)) {
      continue
    }
    $profileSegments = ([string]$billingSubscription.billingProfileId).Split('/')
    $profileName = $profileSegments[-1]
    $accountName = [string]$billingAccount.name
    $encodedAccount = [uri]::EscapeDataString($accountName)
    $balanceUrl = "https://management.azure.com/providers/Microsoft.Billing/billingAccounts/$encodedAccount/billingProfiles/$profileName/providers/Microsoft.Consumption/credits/balanceSummary?api-version=2024-08-01"
    $balance = Invoke-AzureJson @('rest', '--method', 'get', '--url', $balanceUrl)
    return [decimal]$balance.properties.balanceSummary.currentBalance.value
  }
  throw 'No fue posible confirmar el saldo del crédito estudiantil. No se crearán recursos.'
}

if (
  $ResourceGroupName -ne 'rg-neurobot-business-prod' -or
  $Location -ne 'chilecentral' -or
  $VmName -ne 'vm-neurobot-business' -or
  $VmSize -ne 'Standard_B2ats_v2'
) {
  throw 'La arquitectura de producción está fijada al resource group, región, VM y SKU previamente validados.'
}

& $azureCli account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { throw 'No fue posible seleccionar la suscripción solicitada.' }
$account = Invoke-AzureJson @('account', 'show')
if ($account.id -ne $SubscriptionId -or $account.name -ne $SubscriptionName -or $account.state -ne 'Enabled') {
  throw "La suscripción activa no es exactamente '$SubscriptionName' habilitada. No se crearán recursos."
}
$subscriptionMetadata = Invoke-AzureJson @(
  'rest', '--method', 'get',
  '--url', "https://management.azure.com/subscriptions/${SubscriptionId}?api-version=2022-12-01"
)
if ($subscriptionMetadata.subscriptionPolicies.quotaId -notlike 'AzureForStudents*') {
  throw 'El identificador de oferta no corresponde a Azure for Students.'
}
if ($subscriptionMetadata.subscriptionPolicies.spendingLimit -ne 'On') {
  throw 'El límite de gasto de la suscripción estudiantil no está activado.'
}

$vmPrice = Get-RetailItems "serviceName eq 'Virtual Machines' and armRegionName eq '$Location' and armSkuName eq '$VmSize' and priceType eq 'Consumption'" |
  Where-Object { $_.productName -like 'Virtual Machines*' -and $_.meterName -notmatch 'Spot|Low Priority' } |
  Sort-Object retailPrice |
  Select-Object -First 1
$diskPrice = Get-RetailItems "productName eq 'Premium SSD Managed Disks' and armRegionName eq '$Location' and priceType eq 'Consumption'" |
  Where-Object { $_.skuName -eq 'P6 LRS' -and $_.meterName -eq 'P6 LRS Disk' } |
  Select-Object -First 1
$ipPrice = Get-RetailItems "productName eq 'IP Addresses' and armRegionName eq '$Location' and priceType eq 'Consumption'" |
  Where-Object { $_.skuName -eq 'Standard' -and $_.meterName -eq 'Standard IPv4 Static Public IP' } |
  Select-Object -First 1
if ($null -eq $vmPrice -or $null -eq $diskPrice -or $null -eq $ipPrice) {
  throw 'No fue posible confirmar todos los precios minoristas. No se crearán recursos.'
}

$monthlyVm = [decimal]$vmPrice.retailPrice * 730
$monthlyDisk = [decimal]$diskPrice.retailPrice
$monthlyIp = [decimal]$ipPrice.retailPrice * 730
$monthlyBaseRetail = $monthlyVm + $monthlyDisk + $monthlyIp
$creditBalance = Get-StudentCreditBalance $SubscriptionId

Write-Host ''
Write-Host "Suscripción verificada: $($account.name) ($($account.id))"
Write-Host "Oferta: $($subscriptionMetadata.subscriptionPolicies.quotaId); límite de gasto: On"
Write-Host "Saldo estudiantil confirmado: USD $([math]::Round($creditBalance, 2))"
Write-Host 'Estimación minorista base si los beneficios gratuitos de 12 meses no aplicaran:'
Write-Host ("  VM {0}: USD {1:N2}/mes" -f $VmSize, $monthlyVm)
Write-Host ("  Disco P6 Premium SSD LRS 64 GiB: USD {0:N2}/mes" -f $monthlyDisk)
Write-Host ("  IPv4 pública Standard: USD {0:N2}/mes" -f $monthlyIp)
Write-Host ("  Total base aproximado: USD {0:N2}/mes" -f $monthlyBaseRetail)
Write-Host 'VNet, NIC, NSG y tráfico entrante no añaden cargo; los primeros 100 GB/mes de salida están incluidos.'
Write-Host 'Salida superior a 100 GB/mes, operaciones de disco fuera de franquicia y snapshots consumirían crédito adicional.'

if ($creditBalance -lt $monthlyBaseRetail) {
  throw 'El saldo estudiantil no cubre ni un mes de la estimación minorista base. No se crearán recursos.'
}

$availableSizes = @(Invoke-AzureJson @('vm', 'list-sizes', '--location', $Location))
if (-not ($availableSizes | Where-Object { $_.name -eq $VmSize })) {
  throw "$VmSize no está disponible para esta suscripción en $Location."
}
$computeUsage = @(Invoke-AzureJson @('vm', 'list-usage', '--location', $Location))
$regionalCoreQuota = $computeUsage | Where-Object { $_.name.value -eq 'cores' } | Select-Object -First 1
$familyCoreQuota = $computeUsage | Where-Object {
  $_.name.value -eq 'standardBasv2Family'
} | Select-Object -First 1
if (
  $null -eq $regionalCoreQuota -or
  $null -eq $familyCoreQuota -or
  ([int]$regionalCoreQuota.limit - [int]$regionalCoreQuota.currentValue) -lt 2 -or
  ([int]$familyCoreQuota.limit - [int]$familyCoreQuota.currentValue) -lt 2
) {
  throw 'La cuota disponible en Chile Central no permite crear Standard_B2ats_v2.'
}
$image = Invoke-AzureJson @(
  'vm', 'image', 'show', '--location', $Location,
  '--urn', 'Canonical:ubuntu-24_04-lts:server:latest'
)
if ($image.architecture -ne 'x64' -or $image.hyperVGeneration -ne 'V2') {
  throw 'La imagen Ubuntu 24.04 LTS x64 Gen2 no está disponible en la región elegida.'
}

if ([string]::IsNullOrWhiteSpace($DnsLabelPrefix)) {
  $shortSubscription = $SubscriptionId.Replace('-', '').Substring(0, 6).ToLowerInvariant()
  $DnsLabelPrefix = "neurobot-business-$shortSubscription"
}
if ($DnsLabelPrefix -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$') {
  throw 'DnsLabelPrefix debe ser un nombre DNS de Azure válido, en minúsculas.'
}

$keyDirectory = Split-Path -Parent $privateKeyPath
[System.IO.Directory]::CreateDirectory($keyDirectory) | Out-Null
if (-not (Test-Path -LiteralPath $privateKeyPath)) {
  & $sshKeygen -q -t ed25519 -f $privateKeyPath -N '""' -C 'neurobot-azure'
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible generar la clave SSH.' }
}
if (-not (Test-Path -LiteralPath $publicKeyPath)) {
  throw "Falta la clave pública SSH: $publicKeyPath"
}
$sshPublicKey = [System.IO.File]::ReadAllText($publicKeyPath).Trim()
$administratorIp = [string](Invoke-RestMethod -Uri 'https://api.ipify.org' -Method Get)
if ($administratorIp -notmatch '^\d{1,3}(?:\.\d{1,3}){3}$') {
  throw 'No fue posible determinar una IPv4 segura para restringir SSH.'
}
$sshSourceAddressPrefix = "$administratorIp/32"
$environmentValues = Assert-ProductionEnvironment $environmentPath

foreach ($providerNamespace in @('Microsoft.Compute', 'Microsoft.Network')) {
  $provider = Invoke-AzureJson @('provider', 'show', '--namespace', $providerNamespace)
  if ($provider.registrationState -ne 'Registered') {
    throw "El proveedor $providerNamespace no está registrado; el preflight no modificará la suscripción."
  }
}

$resourceGroupExists = [bool](Invoke-AzureJson @('group', 'exists', '--name', $ResourceGroupName))
$existingPublicIp = $false
$existingVm = $false
if ($resourceGroupExists) {
  $allowedResources = @{
    'microsoft.compute/virtualmachines' = @($VmName)
    'microsoft.compute/disks' = @("$VmName-osdisk")
    'microsoft.network/networkinterfaces' = @("$VmName-nic")
    'microsoft.network/networksecuritygroups' = @("$VmName-nsg")
    'microsoft.network/publicipaddresses' = @("$VmName-pip")
    'microsoft.network/virtualnetworks' = @("$VmName-vnet")
  }
  $existingResources = @(Invoke-AzureJson @('resource', 'list', '--resource-group', $ResourceGroupName))
  $unexpectedExistingResources = @($existingResources | Where-Object {
    $type = ([string]$_.type).ToLowerInvariant()
    -not $allowedResources.ContainsKey($type) -or
    $allowedResources[$type] -notcontains [string]$_.name
  })
  if ($unexpectedExistingResources.Count -gt 0) {
    throw 'El resource group contiene recursos ajenos a la arquitectura validada. No se continuará.'
  }
  $existingPublicIp = $null -ne ($existingResources | Where-Object {
    ([string]$_.type).ToLowerInvariant() -eq 'microsoft.network/publicipaddresses' -and
    $_.name -eq "$VmName-pip"
  } | Select-Object -First 1)
  $existingVm = $null -ne ($existingResources | Where-Object {
    ([string]$_.type).ToLowerInvariant() -eq 'microsoft.compute/virtualmachines' -and
    $_.name -eq $VmName
  } | Select-Object -First 1)
}

if (-not $existingPublicIp) {
  $armAccessToken = & $azureCli account get-access-token `
    --resource 'https://management.azure.com/' `
    --query accessToken --only-show-errors --output tsv
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($armAccessToken -join ''))) {
    throw 'No fue posible comprobar la disponibilidad del hostname público.'
  }
  try {
    $encodedDnsLabel = [uri]::EscapeDataString($DnsLabelPrefix)
    $dnsAvailabilityUri = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.Network/locations/$Location/checkDnsNameAvailability?api-version=2025-05-01&domainNameLabel=$encodedDnsLabel"
    $dnsAvailability = Invoke-RestMethod -Method Get -Uri $dnsAvailabilityUri -Headers @{
      Authorization = "Bearer $(($armAccessToken -join '').Trim())"
    }
  } finally {
    $armAccessToken = $null
  }
  if ($dnsAvailability.available -ne $true) {
    throw 'El hostname público previsto no está disponible. No se crearán recursos.'
  }
}

& $azureCli bicep build --file $templatePath --stdout | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'La plantilla Bicep no es válida.' }

$templateArguments = @(
  '--location', $Location,
  '--template-file', $templatePath,
  '--parameters',
  "location=$Location",
  "resourceGroupName=$ResourceGroupName",
  "vmName=$VmName",
  "adminUsername=$AdminUsername",
  "sshPublicKey=$sshPublicKey",
  "sshSourceAddressPrefix=$sshSourceAddressPrefix",
  "dnsLabelPrefix=$DnsLabelPrefix",
  "vmSize=$VmSize",
  "deployVm=$((-not $existingVm).ToString().ToLowerInvariant())"
)
$validation = Invoke-AzureJson (@(
  'deployment', 'sub', 'validate', '--name', 'neurobot-final-validation'
) + $templateArguments)
if ($validation.properties.provisioningState -ne 'Succeeded') {
  throw 'Azure no validó correctamente la plantilla de producción.'
}
$whatIf = Invoke-AzureJson (@(
  'deployment', 'sub', 'what-if', '--name', 'neurobot-final-what-if'
) + $templateArguments + @('--result-format', 'ResourceIdOnly', '--no-pretty-print'))
if ($whatIf.status -ne 'Succeeded' -or $null -ne $whatIf.error) {
  throw 'Azure What-If no pudo confirmar los cambios de infraestructura.'
}

$resourceGroupId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName"
$expectedResourceIds = @(
  $resourceGroupId,
  "$resourceGroupId/providers/Microsoft.Compute/virtualMachines/$VmName",
  "$resourceGroupId/providers/Microsoft.Network/networkInterfaces/$VmName-nic",
  "$resourceGroupId/providers/Microsoft.Network/networkSecurityGroups/$VmName-nsg",
  "$resourceGroupId/providers/Microsoft.Network/publicIPAddresses/$VmName-pip",
  "$resourceGroupId/providers/Microsoft.Network/virtualNetworks/$VmName-vnet",
  "$resourceGroupId/providers/Microsoft.Network/virtualNetworks/$VmName-vnet/subnets/application"
) | ForEach-Object { $_.ToLowerInvariant() }
$materialChanges = @($whatIf.changes | Where-Object { $_.changeType -ne 'Ignore' })
$unexpectedChanges = @($materialChanges | Where-Object {
  $expectedResourceIds -notcontains ([string]$_.resourceId).ToLowerInvariant()
})
$destructiveChanges = @($materialChanges | Where-Object { $_.changeType -eq 'Delete' })
if ($unexpectedChanges.Count -gt 0 -or $destructiveChanges.Count -gt 0) {
  throw 'Azure What-If detectó recursos inesperados o cambios destructivos. No se continuará.'
}
if (-not $resourceGroupExists) {
  $plannedCreates = @($materialChanges | Where-Object { $_.changeType -eq 'Create' } |
    ForEach-Object { ([string]$_.resourceId).ToLowerInvariant() })
  $missingExpectedCreates = @($expectedResourceIds | Where-Object { $plannedCreates -notcontains $_ })
  if ($missingExpectedCreates.Count -gt 0 -or $plannedCreates.Count -ne $expectedResourceIds.Count) {
    throw 'Azure What-If no coincide exactamente con los siete recursos previstos.'
  }
}

if (-not $Apply) {
  Write-Host ''
  Write-Host 'Preflight completado. No se creó ningún recurso.'
  Write-Host "Destino: $ResourceGroupName, Chile Central, $VmSize, una VM y su red mínima."
  Write-Host 'Cuenta simple validada; META_WHATSAPP_ACCOUNTS_JSON está vacío y el archivo permanece fuera del repositorio.'
  return
}

$userProfilePath = [Environment]::GetFolderPath('UserProfile')
$bundledPython = Join-Path $userProfilePath '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$python = if (Test-Path -LiteralPath $bundledPython -PathType Leaf) {
  $bundledPython
} else {
  Resolve-CommandPath 'python'
}

Write-Host 'Validando el proyecto antes de desplegar...'
Push-Location $repositoryRoot
$previousPython = $env:PYTHON
try {
  $env:PYTHON = $python
  & $npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci falló.' }
  & $npm run check
  if ($LASTEXITCODE -ne 0) { throw 'npm run check falló.' }
} finally {
  if ([string]::IsNullOrEmpty($previousPython)) {
    Remove-Item Env:PYTHON -ErrorAction SilentlyContinue
  } else {
    $env:PYTHON = $previousPython
  }
  Pop-Location
}

foreach ($providerNamespace in @('Microsoft.Compute', 'Microsoft.Network')) {
  $provider = Invoke-AzureJson @('provider', 'show', '--namespace', $providerNamespace)
  if ($provider.registrationState -ne 'Registered') {
    Write-Host "Registrando proveedor necesario: $providerNamespace"
    & $azureCli provider register --namespace $providerNamespace --wait --only-show-errors --output none
    if ($LASTEXITCODE -ne 0) { throw "No fue posible registrar $providerNamespace." }
  }
}

$deploymentName = "neurobot-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
$deploymentArguments = @(
  'deployment', 'sub', 'create',
  '--name', $deploymentName,
  '--location', $Location,
  '--template-file', $templatePath,
  '--parameters',
  "location=$Location",
  "resourceGroupName=$ResourceGroupName",
  "vmName=$VmName",
  "adminUsername=$AdminUsername",
  "sshPublicKey=$sshPublicKey",
  "sshSourceAddressPrefix=$sshSourceAddressPrefix",
  "dnsLabelPrefix=$DnsLabelPrefix",
  "vmSize=$VmSize",
  "deployVm=$((-not $existingVm).ToString().ToLowerInvariant())"
)
$deployment = Invoke-AzureJson $deploymentArguments

$publicIpAddress = [string]$deployment.properties.outputs.publicIpAddress.value
$publicHostname = [string]$deployment.properties.outputs.publicHostname.value
$webhookUrl = [string]$deployment.properties.outputs.webhookUrl.value

Write-Host 'Esperando que Ubuntu complete la preparación inicial...'
$cloudInit = Invoke-AzureJson @(
  'vm', 'run-command', 'invoke',
  '--resource-group', $ResourceGroupName,
  '--name', $VmName,
  '--command-id', 'RunShellScript',
  '--scripts', 'cloud-init status --wait >/dev/null 2>&1 || true; test -f /var/lib/neurobot/.host-ready && systemctl is-active --quiet caddy.service && test -x /usr/bin/node && echo NEUROBOT_HOST_READY'
)
$cloudInitStatus = [string](($cloudInit.value | Select-Object -First 1).code)
$cloudInitMessage = [string](($cloudInit.value | Select-Object -First 1).message)
if ($cloudInitStatus -ne 'ProvisioningState/succeeded' -or $cloudInitMessage -notmatch 'NEUROBOT_HOST_READY') {
  throw 'cloud-init no confirmó una preparación correcta de la VM.'
}

$sshOptions = @(
  '-i', $privateKeyPath,
  '-o', 'IdentitiesOnly=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=10'
)
$sshReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  & $ssh @sshOptions "${AdminUsername}@${publicIpAddress}" 'true' 2>$null
  if ($LASTEXITCODE -eq 0) {
    $sshReady = $true
    break
  }
  Start-Sleep -Seconds 5
}
if (-not $sshReady) { throw 'La VM no aceptó la conexión SSH restringida.' }

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "neurobot-deploy-$([guid]::NewGuid())"
[System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
$archivePath = Join-Path $temporaryDirectory 'neurobot-release.tgz'
$remoteStagingDirectory = "/home/$AdminUsername/.neurobot-deploy"
$remoteArchivePath = "$remoteStagingDirectory/neurobot-release.tgz"
$remoteEnvironmentPath = "$remoteStagingDirectory/neurobot.env"
try {
  Push-Location $repositoryRoot
  try {
    & $tar -czf $archivePath package.json package-lock.json dist public
    if ($LASTEXITCODE -ne 0) { throw 'No fue posible crear el paquete de despliegue.' }
  } finally {
    Pop-Location
  }

  $prepareStagingCommand = "install -d -m 0700 '$remoteStagingDirectory' && umask 077 && : > '$remoteArchivePath' && : > '$remoteEnvironmentPath'"
  & $ssh @sshOptions "${AdminUsername}@${publicIpAddress}" $prepareStagingCommand
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible preparar el área privada de despliegue.' }
  & $scp @sshOptions $archivePath "${AdminUsername}@${publicIpAddress}:${remoteArchivePath}"
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible transferir la aplicación.' }
  & $scp @sshOptions $environmentPath "${AdminUsername}@${publicIpAddress}:${remoteEnvironmentPath}"
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible transferir el entorno cifrado por SSH.' }
  $remoteDeployCommand = "sudo /usr/local/sbin/deploy-neurobot-release '$remoteArchivePath' '$remoteEnvironmentPath'"
  & $ssh @sshOptions "${AdminUsername}@${publicIpAddress}" $remoteDeployCommand
  if ($LASTEXITCODE -ne 0) { throw 'El despliegue remoto no finalizó correctamente.' }
} finally {
  if ($sshReady) {
    $cleanupCommand = "rm -f '$remoteArchivePath' '$remoteEnvironmentPath'"
    & $ssh @sshOptions "${AdminUsername}@${publicIpAddress}" $cleanupCommand 2>$null
  }
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}

$baseUrl = "https://$publicHostname"

function Assert-VmRunning {
  $instanceView = Invoke-AzureJson @(
    'vm', 'get-instance-view', '--resource-group', $ResourceGroupName, '--name', $VmName
  )
  $running = $instanceView.instanceView.statuses | Where-Object {
    $_.code -eq 'PowerState/running'
  } | Select-Object -First 1
  if ($null -eq $running) { throw 'Azure no informa la VM en estado activo.' }
}

function Wait-HttpsHealth {
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
      # Invoke-RestMethod validates the public certificate and hostname by default.
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get -TimeoutSec 10
      if ($health.ok -eq $true) { return }
    } catch {
      # TLS issuance and reboots can take a few moments. Never print request details.
    }
    Start-Sleep -Seconds 5
  }
  throw 'El endpoint HTTPS de salud no respondió con un certificado válido.'
}

function Assert-HttpRedirect {
  $headers = & $curl --silent --show-error --dump-header - --output NUL --max-redirs 0 `
    "http://$publicHostname/api/health"
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible comprobar la redirección HTTP.' }
  $headerText = $headers -join "`n"
  $escapedHostname = [regex]::Escape($publicHostname)
  if (
    $headerText -notmatch '(?im)^HTTP/\S+\s+30(?:1|2|7|8)\b' -or
    $headerText -notmatch "(?im)^location:\s*https://${escapedHostname}/api/health\s*$"
  ) {
    throw 'HTTP no redirige de forma exacta al endpoint HTTPS.'
  }
}

Assert-VmRunning
Wait-HttpsHealth
Assert-HttpRedirect

$challenge = "deployment-$([guid]::NewGuid().ToString('N'))"
$verifyToken = [uri]::EscapeDataString([string]$environmentValues['META_WEBHOOK_VERIFY_TOKEN'])
$verificationUri = "${webhookUrl}?hub.mode=subscribe&hub.verify_token=$verifyToken&hub.challenge=$challenge"
try {
  $verificationResponse = Invoke-WebRequest -UseBasicParsing -Uri $verificationUri -Method Get -TimeoutSec 15
  if ($verificationResponse.StatusCode -ne 200 -or $verificationResponse.Content -ne $challenge) {
    throw 'respuesta inesperada'
  }
} catch {
  throw 'El webhook HTTPS no superó la verificación challenge de Meta.'
}
$verificationUri = $null
$verifyToken = $null

$metaPayload = @{
  object = 'whatsapp_business_account'
  entry = @(
    @{
      id = [string]$environmentValues['META_WABA_ID']
      changes = @(
        @{
          field = 'messages'
          value = @{
            messaging_product = 'whatsapp'
            metadata = @{ phone_number_id = [string]$environmentValues['META_PHONE_NUMBER_ID'] }
          }
        }
      )
    }
  )
}
$rawMetaPayload = $metaPayload | ConvertTo-Json -Compress -Depth 10
$hmacKey = [System.Text.Encoding]::UTF8.GetBytes([string]$environmentValues['META_APP_SECRET'])
$hmac = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList (, $hmacKey)
try {
  $signatureBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($rawMetaPayload))
  $signature = [System.BitConverter]::ToString($signatureBytes).Replace('-', '').ToLowerInvariant()
} finally {
  $hmac.Dispose()
  [Array]::Clear($hmacKey, 0, $hmacKey.Length)
}
try {
  $signedResponse = Invoke-RestMethod -Uri $webhookUrl -Method Post -TimeoutSec 15 `
    -ContentType 'application/json' `
    -Headers @{ 'X-Hub-Signature-256' = "sha256=$signature" } `
    -Body $rawMetaPayload
  if ($signedResponse.received -ne $true) { throw 'respuesta inesperada' }
} catch {
  throw 'El webhook POST no aceptó un payload inocuo con firma válida.'
} finally {
  $signature = $null
}

$invalidSignatureRejected = $false
try {
  Invoke-WebRequest -UseBasicParsing -Uri $webhookUrl -Method Post -TimeoutSec 15 `
    -ContentType 'application/json' `
    -Headers @{ 'X-Hub-Signature-256' = "sha256=$('0' * 64)" } `
    -Body $rawMetaPayload | Out-Null
} catch {
  if ($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
    $invalidSignatureRejected = $true
  }
}
$rawMetaPayload = $null
$metaPayload = $null
if (-not $invalidSignatureRejected) {
  throw 'El webhook POST no rechazó de la forma esperada una firma inválida.'
}

$configurationCommand = @'
sudo python3 - <<'PY'
from pathlib import Path
import os
import sqlite3
import stat
import subprocess

def parse_lines(raw: bytes):
    values = {}
    for line in raw.splitlines():
        if not line or line.lstrip().startswith(b'#') or b'=' not in line:
            continue
        key, value = line.split(b'=', 1)
        values[key.strip()] = value.strip()
    return values

environment_path = Path('/etc/neurobot/neurobot.env')
mode = stat.S_IMODE(environment_path.stat().st_mode)
if environment_path.stat().st_uid != 0 or mode != 0o640:
    raise SystemExit(10)
configured = parse_lines(environment_path.read_bytes())
if configured.get(b'META_WHATSAPP_ACCOUNTS_JSON', b'') != b'':
    raise SystemExit(11)
pid = subprocess.check_output(
    ['systemctl', 'show', '--property', 'MainPID', '--value', 'neurobot.service'],
    text=True,
).strip()
if not pid.isdigit() or pid == '0':
    raise SystemExit(12)
running = parse_lines(Path(f'/proc/{pid}/environ').read_bytes().replace(b'\0', b'\n'))
for key in (
    b'META_ACCESS_TOKEN', b'META_PHONE_NUMBER_ID', b'META_WABA_ID',
    b'META_APP_SECRET', b'META_WEBHOOK_VERIFY_TOKEN', b'GROQ_API_KEY',
):
    if not configured.get(key) or running.get(key) != configured[key]:
        raise SystemExit(13)
connection = sqlite3.connect('/var/lib/neurobot/data/neurobot.db')
try:
    row = connection.execute(
        'SELECT meta_phone_number_id FROM assistant_connectors '
        'WHERE assistant_id=? AND connector_type=? LIMIT 1',
        ('neurobot', 'WHATSAPP_CLOUD_API'),
    ).fetchone()
finally:
    connection.close()
if row is None or row[0].encode() != configured[b'META_PHONE_NUMBER_ID']:
    raise SystemExit(14)
print('configuration-ok')
PY
'@
$configurationResult = & $ssh @sshOptions "${AdminUsername}@${publicIpAddress}" $configurationCommand
if ($LASTEXITCODE -ne 0 -or ($configurationResult -join '').Trim() -ne 'configuration-ok') {
  throw 'La cuenta simple cargada por el proceso no coincide con el entorno externo o SQLite.'
}

$persistenceCommand = @'
set -Eeuo pipefail
database=/var/lib/neurobot/data/neurobot.db
sudo test -s "$database"
before_inode="$(sudo stat --format='%d:%i' "$database")"
sudo sqlite3 "$database" 'PRAGMA quick_check;' | grep -Fx ok >/dev/null
sudo systemctl restart neurobot.service
health_ready=false
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3001/api/health | jq -e '.ok == true' >/dev/null; then
    health_ready=true
    break
  fi
  sleep 1
done
test "$health_ready" = true
after_inode="$(sudo stat --format='%d:%i' "$database")"
test "$before_inode" = "$after_inode"
sudo sqlite3 "$database" 'PRAGMA quick_check;' | grep -Fx ok >/dev/null
sudo systemctl is-active --quiet neurobot.service
sudo systemctl is-enabled --quiet neurobot.service
sudo systemctl is-active --quiet caddy.service
sudo systemctl is-enabled --quiet caddy.service
printf '%s\n' "$after_inode"
'@
$persistenceResult = & $ssh @sshOptions "${AdminUsername}@${publicIpAddress}" $persistenceCommand
$databaseIdentityBeforeReboot = ($persistenceResult -join '').Trim()
if ($LASTEXITCODE -ne 0 -or $databaseIdentityBeforeReboot -notmatch '^\d+:\d+$') {
  throw 'La comprobación de servicios y persistencia SQLite falló.'
}

$loginPayload = @{
  username = 'admin'
  password = [string]$environmentValues['PANEL_INITIAL_PASSWORD']
} | ConvertTo-Json -Compress
try {
  $loginResponse = Invoke-RestMethod -Uri "$baseUrl/api/auth/login" -Method Post `
    -ContentType 'application/json' -Body $loginPayload -SessionVariable panelSession -TimeoutSec 15
  if ($loginResponse.authenticated -ne $true -or [string]::IsNullOrWhiteSpace($loginResponse.csrfToken)) {
    throw 'respuesta inesperada'
  }
  $statusResponse = Invoke-RestMethod -Uri "$baseUrl/api/status" -Method Get `
    -WebSession $panelSession -TimeoutSec 15
  if ($null -eq $statusResponse -or $null -eq $statusResponse.version) {
    throw 'estado inesperado'
  }
  $groqResponse = Invoke-RestMethod -Uri "$baseUrl/api/ai/test-connection" -Method Post `
    -WebSession $panelSession -Headers @{ 'X-CSRF-Token' = [string]$loginResponse.csrfToken } `
    -TimeoutSec 30
  if ($groqResponse.configured -ne $true -or $groqResponse.connection -ne 'successful') {
    throw 'conectividad de IA fallida'
  }
} catch {
  throw 'El smoke test autenticado del backend o la conectividad de Groq falló.'
} finally {
  $loginPayload = $null
}

Write-Host 'Reiniciando la VM para comprobar el arranque automático y la persistencia...'
& $azureCli vm restart --resource-group $ResourceGroupName --name $VmName `
  --only-show-errors --output none
if ($LASTEXITCODE -ne 0) { throw 'Azure no pudo reiniciar la VM para la prueba final.' }

$sshReadyAfterReboot = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
  & $ssh @sshOptions "${AdminUsername}@${publicIpAddress}" 'true' 2>$null
  if ($LASTEXITCODE -eq 0) {
    $sshReadyAfterReboot = $true
    break
  }
  Start-Sleep -Seconds 5
}
if (-not $sshReadyAfterReboot) { throw 'SSH no volvió a estar disponible después del reinicio.' }

$postRebootCommand = @"
set -Eeuo pipefail
database=/var/lib/neurobot/data/neurobot.db
sudo systemctl is-active --quiet neurobot.service
sudo systemctl is-enabled --quiet neurobot.service
sudo systemctl is-active --quiet caddy.service
sudo systemctl is-enabled --quiet caddy.service
test "`$(sudo stat --format='%d:%i' "`$database")" = '$databaseIdentityBeforeReboot'
sudo sqlite3 "`$database" 'PRAGMA quick_check;' | grep -Fx ok >/dev/null
for attempt in {1..60}; do
  if curl --fail --silent http://127.0.0.1:3001/api/health | jq -e '.ok == true' >/dev/null; then
    exit 0
  fi
  sleep 2
done
exit 1
"@
& $ssh @sshOptions "${AdminUsername}@${publicIpAddress}" $postRebootCommand
if ($LASTEXITCODE -ne 0) {
  throw 'Neurobot, Caddy o SQLite no se recuperaron correctamente después del reinicio.'
}

Assert-VmRunning
Wait-HttpsHealth
Assert-HttpRedirect

Write-Host ''
Write-Host 'Despliegue verificado correctamente.'
Write-Host "Resource group: $ResourceGroupName"
Write-Host "VM: $VmName ($Location, $VmSize)"
Write-Host "IP pública: $publicIpAddress"
Write-Host "Hostname: $publicHostname"
Write-Host "Panel: $baseUrl"
Write-Host "Webhook de Meta: $webhookUrl"
Write-Host 'Verificaciones: VM activa; systemd y Caddy activos/habilitados; HTTPS válido; HTTP redirige; SQLite persistente.'
Write-Host 'Integraciones: challenge GET y firmas POST de Meta correctos; cuenta simple cargada; Groq conectado.'
Write-Host "SSH: ssh -i `"$privateKeyPath`" ${AdminUsername}@${publicIpAddress}"
