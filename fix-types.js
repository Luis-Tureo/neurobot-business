import { readFileSync, writeFileSync } from 'node:fs';

let content = readFileSync('src/domain/types.ts', 'utf8');

// I will just use regex to remove everything from GroupDiscoveryState to the end of PollDateOverride block.
// To be safe, I'll match starting at export type GroupDiscoveryState to the end of the file, or up to the next export type that I want to keep.
// Wait, the easiest way is to use a script that just chops out these exact types using AST or carefully crafted regex.
content = content.replace(/export type GroupDiscoveryState =[\s\S]*?export type PollDateOverride = \{[\s\S]*?\};\n/m, '');
content = content.replace(/export type NativePoll = \{[\s\S]*?\};\n/m, '');
content = content.replace(/export type PollDeliverySource =[\s\S]*?;\n/m, '');
content = content.replace(/export type PollDeliveryStatus =[\s\S]*?;\n/m, '');
content = content.replace(/export type GroupStatus =[\s\S]*?;\n/m, '');
content = content.replace(/export type GroupListSource =[\s\S]*?;\n/m, '');

writeFileSync('src/domain/types.ts', content);
console.log('Fixed types.ts');
