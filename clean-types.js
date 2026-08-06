import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'src/domain/types.ts');
let content = readFileSync(file, 'utf8');

// Fix ConnectionSnapshot
content = content.replace(/export type ConnectionSnapshot = \{[\s\S]*?\};/, `export type ConnectionSnapshot = {
  state: ConnectionState;
  lastConnectedAt: string | null;
  reconnectAttempt: number;
  lastErrorCode: string | null;
  qrCode: string | null;
  phoneNumber: string | null;
};`);

// Remove group and poll related types
content = content.replace(/export type GroupDiscoveryState = [\s\S]*?export type/g, 'export type');
content = content.replace(/export type GroupDiscoverySnapshot = \{[\s\S]*?\};/g, '');
content = content.replace(/export type PollSelectionMode = [\s\S]*?export type/g, 'export type');
content = content.replace(/export type PollDeliverySource = [\s\S]*?export type/g, 'export type');
content = content.replace(/export type PollDeliveryStatus = [\s\S]*?export type/g, 'export type');
content = content.replace(/export type NativePoll = \{[\s\S]*?\};/g, '');
content = content.replace(/export type PollTemplate = [\s\S]*?\};/g, '');
content = content.replace(/export type HiddenPollTemplate = [\s\S]*?\};/g, '');
content = content.replace(/export type PollConfiguration = \{[\s\S]*?\};/g, '');
content = content.replace(/export type PollDelivery = \{[\s\S]*?\};/g, '');
content = content.replace(/export type PollInteraction = \{[\s\S]*?\};/g, '');
content = content.replace(/export type PollResult = \{[\s\S]*?\};/g, '');
content = content.replace(/export type GroupListSource = [\s\S]*?export type/g, 'export type');
content = content.replace(/export type GroupSynchronizationSummary = \{[\s\S]*?\};/g, '');

writeFileSync(file, content);
console.log('types.ts cleaned up.');
