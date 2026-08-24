#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '../dist/cli.js');

if (!existsSync(entry)) {
  console.error('polycode: build output not found at dist/cli.js.');
  console.error('Run `npm run build` first, then retry.');
  process.exit(1);
}

try {
  await import(pathToFileURL(entry).href);
} catch (error) {
  console.error(error?.stack ?? error);
  process.exit(1);
}
