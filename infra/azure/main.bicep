targetScope = 'subscription'

@description('Azure region used by every resource.')
param location string = 'chilecentral'

@description('Resource group dedicated to Neurobot Business.')
param resourceGroupName string = 'rg-neurobot-business-prod'

@description('Linux virtual machine name.')
param vmName string = 'vm-neurobot-business'

@description('Linux administrator account used only for SSH maintenance.')
param adminUsername string = 'azureadmin'

@secure()
@description('OpenSSH public key. The private key must stay outside the repository.')
param sshPublicKey string

@description('Single IPv4 CIDR allowed to connect over SSH, for example 203.0.113.10/32.')
param sshSourceAddressPrefix string

@description('Unique Azure public DNS label. The resulting hostname receives the TLS certificate.')
param dnsLabelPrefix string

@allowed([
  'Standard_B2ats_v2'
])
@description('Azure for Students free-service eligible VM size selected by the deployment preflight.')
param vmSize string = 'Standard_B2ats_v2'

@description('Create the VM on the initial deployment. Set false when reusing the existing production VM.')
param deployVm bool = true

param tags object = {
  application: 'neurobot-business'
  environment: 'production'
  managedBy: 'bicep'
}

resource deploymentResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module neurobotResources './neurobot.bicep' = {
  name: 'neurobot-business-resources'
  scope: deploymentResourceGroup
  params: {
    location: location
    vmName: vmName
    adminUsername: adminUsername
    sshPublicKey: sshPublicKey
    sshSourceAddressPrefix: sshSourceAddressPrefix
    dnsLabelPrefix: dnsLabelPrefix
    vmSize: vmSize
    deployVm: deployVm
    tags: tags
  }
}

output resourceGroupName string = deploymentResourceGroup.name
output vmName string = neurobotResources.outputs.vmName
output publicIpAddress string = neurobotResources.outputs.publicIpAddress
output publicHostname string = neurobotResources.outputs.publicHostname
output webhookUrl string = 'https://${neurobotResources.outputs.publicHostname}/api/webhooks/meta/whatsapp'
