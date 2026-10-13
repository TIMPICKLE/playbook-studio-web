import { cp, mkdir, rm } from 'node:fs/promises';
const pages = new URL('../github-pages/', import.meta.url);
await rm(pages, { recursive: true, force: true }); await mkdir(pages, { recursive: true });
await cp(new URL('../web/', import.meta.url), pages, { recursive: true });
await cp(new URL('../web/index.html', import.meta.url), new URL('../pages/local.html', import.meta.url));
await cp(new URL('../web/landing.html', import.meta.url), new URL('../pages/index.html', import.meta.url));
