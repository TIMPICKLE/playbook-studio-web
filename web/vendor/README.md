# Vendored browser dependency

`tsparticles.slim-4.4.0.min.js` is the unmodified tsParticles Slim 4.4.0 browser bundle.

- Upstream: https://github.com/tsparticles/tsparticles
- Download: https://cdn.jsdelivr.net/npm/@tsparticles/slim@4.4.0/tsparticles.slim.bundle.min.js
- License: MIT; see `tsparticles.LICENSE.txt`.
- The local copy avoids a runtime CDN dependency. It is loaded lazily, after the usable interface, and never loaded when decorative motion is disabled.
- Upgrade deliberately: update the filename, service-worker cache and source URL together, and check the particle options and reduced-motion behavior.

## Embla Carousel 8.6.0

`embla-carousel-8.6.0/` contains the unmodified ESM browser bundle and source map from the already-installed `embla-carousel` 8.6.0 package. The editor uses its framework-independent core for the playbook card chooser. The stable v8 API is used; no RC upgrade or runtime CDN is needed.

- Source: https://github.com/davidjerleke/embla-carousel/tree/v8.6.0
- Docs: https://www.embla-carousel.com/docs/v8/
- License: MIT; see `embla-carousel-8.6.0/LICENSE`.

## Big Shoulders Display 5.3.0 (font)

`big-shoulders-display-5.3.0/` contains the unmodified Latin variable-weight WOFF2 from `@fontsource-variable/big-shoulders-display` 5.3.0. It is the display face of the v5 "Stage" design (play titles, yard numbers, player labels, brand lockups); Chinese text falls back to the system UI font.

- Upstream: https://github.com/xyztype/Big-Shoulders · packaged by https://fontsource.org
- License: SIL Open Font License 1.1; see `big-shoulders-display-5.3.0/LICENSE`.
- Self-hosted so the editor stays offline-capable; listed in the service-worker cache.

## LangGraph 1.5.3 browser runtime

The static board assistant lazy-loads the ESM browser graph from `assistant-langgraph.js`. Run `node scripts/bundle-board-agent.mjs` after installing the locked dependencies to regenerate it and its license notices. The Worker imports LangGraph from npm.

## Zod board contracts

`assistant-zod.js` bundles the locked Zod dependency for the shared board result schemas and JSON schema generation. Regenerate it with `node scripts/bundle-board-schema.mjs`. The MIT license is in `assistant-zod.NOTICES.txt`.

## d3-interpolate-path 2.3.0

`d3-interpolate-path-2.3.0.js` interpolates directed, open AI route previews with unequal point counts. It is minified from the official 2.3.0 ESM with the project's locked esbuild 0.28.0; there is no browser CDN request or additional runtime dependency.

- Source: https://github.com/pbeshai/d3-interpolate-path/tree/v2.3.0
- License: BSD-3-Clause; see `d3-interpolate-path-2.3.0.LICENSE.txt`.
- Rebuild: `node scripts/bundle-route-morph.mjs` (verifies pinned source and license SHA-256 before writing).
- Design and upgrade checks: `docs/AI_ROUTE_MOTION.md`.
