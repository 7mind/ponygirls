import { lstatSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonPreferences } from '@ponygirls/pi-settings';

const [agentDir, file, dev, ino] = process.argv.slice(2);
const values = JSON.parse(readFileSync(0, 'utf8'));
const project = statSync('.', { bigint: true });
const global = statSync(agentDir, { bigint: true });
if (project.dev !== BigInt(dev) || project.ino !== BigInt(ino) || (project.dev === global.dev && project.ino === global.ino)) throw Error('Project settings directory changed');
const target = lstatSync(file, { bigint: true, throwIfNoEntry: false });
const globalPath = join(agentDir, file), user = statSync(globalPath, { bigint: true, throwIfNoEntry: false });
if ((target && (!target.isFile() || target.nlink !== 1n || (user && target.dev === user.dev && target.ino === user.ino))) || (!user && lstatSync(globalPath, { throwIfNoEntry: false })?.isSymbolicLink())) throw Error('Project settings target is not independent');
writeJsonPreferences(file, values);
