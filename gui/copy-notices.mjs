// Runs after `vite build`: puts the full notices and the project licence text into dist/.
// Order: base notices (Meta API terms, Python, SQLite, FFmpeg, pytest), then the web app, fonts, clips and model notices, then the project LICENSE.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..'), dist = path.join(here, 'dist');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const bar = '\n\n' + '='.repeat(79) + '\n';
const out = 'LabSpotter - complete third-party notices and licence text\n'
  + 'Part A: base notices. Part B: web app, fonts, clips and models. Part C: project licence.\n'
  + 'Scope: Part A is the earlier engine notice text, carried over as recovered. Its statements such as standard library only or no model weights included describe that engine, not this web app or its distribution, and they do not say which models the app uses. Part B states the app scope.\n'
  + 'Where Part A mentions app/docs/THIRD-PARTY-NOTICES-additions.txt, that content is Part B below.\n'
  + bar + 'PART A\n' + '='.repeat(79) + '\n\n' + rd('THIRD-PARTY-NOTICES-BASE.txt')
  + bar + 'PART B\n' + '='.repeat(79) + '\n\n' + rd('THIRD-PARTY-NOTICES.txt')
  + bar + 'PART C - LICENSE\n' + '='.repeat(79) + '\n\n' + rd('LICENSE');
fs.writeFileSync(path.join(dist, 'THIRD-PARTY-NOTICES.txt'), out);
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));
console.log('notices written:', out.length, 'bytes');
