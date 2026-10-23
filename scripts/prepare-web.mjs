import { cp, mkdir, rm } from 'node:fs/promises';
import { materializeHuddleArt } from './huddle-art.mjs';
await materializeHuddleArt();
await mkdir(new URL('../public', import.meta.url), { recursive: true });
await rm(new URL('../public/editor', import.meta.url), { recursive: true, force: true });
await cp(new URL('../web', import.meta.url), new URL('../public/editor', import.meta.url), { recursive: true });
await cp(new URL('../web/index.html', import.meta.url), new URL('../public/editor/local.html', import.meta.url));
