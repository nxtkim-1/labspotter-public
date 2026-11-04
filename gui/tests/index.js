// Entry point so `node --test gui/tests/` works: Node 24 treats that argument as a module path (not a
// directory to scan) and resolves it to this index.js. It loads every *.test.ts here, sorted.
// Equivalent explicit form: node --test 'gui/tests/*.test.ts'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter(f => f.endsWith('.test.ts')).sort();
if (files.length === 0) throw new Error('no *.test.ts files in ' + here);
for (const f of files) await import(pathToFileURL(path.join(here, f)).href);
