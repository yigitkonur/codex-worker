#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const binDir = dirname(fileURLToPath(import.meta.url));
const entrypointUrl = pathToFileURL(resolve(binDir, '../dist/src/cli.js')).href;

await import(entrypointUrl);
