import { readFileSync } from 'node:fs';

describe('despliegue seguro en Azure for Students', () => {
  const main = readFileSync('infra/azure/main.bicep', 'utf8');
  const resources = readFileSync('infra/azure/neurobot.bicep', 'utf8');
  const cloudInit = readFileSync('infra/azure/cloud-init.yaml', 'utf8');
  const environmentTemplate = readFileSync(
    'infra/azure/neurobot.production.env.example',
    'utf8',
  );
  const deployScript = readFileSync('scripts/deploy-azure.ps1', 'utf8');

  it('fija la arquitectura estudiantil mínima y persistente', () => {
    expect(main).toContain("'Standard_B2ats_v2'");
    expect(resources).toContain("offer: 'ubuntu-24_04-lts'");
    expect(resources).toContain('diskSizeGB: 64');
    expect(resources).toContain("storageAccountType: 'Premium_LRS'");
    expect(resources).toContain("sku: {\n    name: 'Standard'");
    expect(resources).toContain('if (deployVm)');
    expect(cloudInit).toContain('WorkingDirectory=/var/lib/neurobot');
    expect(cloudInit).toContain('homedir: /var/lib/neurobot');
    expect(cloudInit).toContain('no_create_home: true');
    expect(environmentTemplate).toContain('DATABASE_PATH=/var/lib/neurobot/data/neurobot.db');
    expect(cloudInit).toContain('npm_config_cache=/var/lib/neurobot/.npm');
  });

  it('solo publica SSH restringido, HTTP y HTTPS', () => {
    expect(resources).toContain('sourceAddressPrefix: sshSourceAddressPrefix');
    expect(resources).toContain("destinationPortRange: '80'");
    expect(resources).toContain("destinationPortRange: '443'");
    expect(resources).not.toContain("destinationPortRange: '3001'");
    expect(environmentTemplate).toContain('PANEL_HOST=127.0.0.1');
  });

  it('aísla secretos, endurece systemd y redirige con TLS', () => {
    expect(cloudInit).toContain('EnvironmentFile=/etc/neurobot/neurobot.env');
    expect(cloudInit).toContain('ProtectSystem=strict');
    expect(cloudInit).toContain('reverse_proxy 127.0.0.1:3001');
    expect(cloudInit).toContain('delete hub.verify_token');
    expect(cloudInit).toContain('request>headers>X-Hub-Signature-256 delete');
    expect(cloudInit).toContain('ufw --force enable');
    expect(cloudInit).not.toContain('META_ACCESS_TOKEN=');
  });

  it('falla antes de crear si la oferta, saldo o precios no se confirman', () => {
    expect(deployScript).toContain('$account.name -ne $SubscriptionName');
    expect(deployScript).toContain("quotaId -notlike 'AzureForStudents*'");
    expect(deployScript).toContain("spendingLimit -ne 'On'");
    expect(deployScript).toContain('$creditBalance -lt $monthlyBaseRetail');
    expect(deployScript).toContain("standardBasv2Family");
    expect(deployScript).toContain('checkDnsNameAvailability');
    expect(deployScript).toContain("'deployment', 'sub', 'what-if'");
    expect(deployScript).toContain('$unexpectedChanges.Count -gt 0');
    expect(deployScript).toContain('if (-not $Apply)');
  });

  it('impone cuenta simple sin incluir el archivo de secretos en Bicep', () => {
    expect(deployScript).toContain("'META_ACCESS_TOKEN'");
    expect(deployScript).toContain("'META_PHONE_NUMBER_ID'");
    expect(deployScript).toContain("'META_WABA_ID'");
    expect(deployScript).toContain("$values.ContainsKey('META_WHATSAPP_ACCOUNTS_JSON')");
    expect(main).not.toContain('META_ACCESS_TOKEN');
    expect(resources).not.toContain('META_ACCESS_TOKEN');
  });

  it('verifica salud, HTTPS, Meta, Groq, reinicio y persistencia de SQLite', () => {
    expect(deployScript).toContain('/api/health');
    expect(deployScript).toContain('Assert-HttpRedirect');
    expect(deployScript).toContain('hub.verify_token=');
    expect(deployScript).toContain('X-Hub-Signature-256');
    expect(deployScript).toContain('/api/ai/test-connection');
    expect(deployScript).toContain('PRAGMA quick_check;');
    expect(deployScript).toContain('before_inode');
    expect(deployScript).toContain('after_inode');
    expect(deployScript).toContain('vm restart');
    expect(deployScript).toContain('is-enabled --quiet neurobot.service');
  });
});
