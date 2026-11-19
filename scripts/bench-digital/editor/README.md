# Full editor timeline benchmark

Use a dedicated QA origin. From the checkout, prepare two frozen versions of the editor and run the production timeline input handler against the same 22-player Mesh play.

```sh
node scripts/bench-digital/prepare-editor.mjs aad1cf6 HEAD ../editor-qa
python3 -m http.server 8000 --directory ../editor-qa/dist
```

Open the index page in desktop Chromium. Run both snapshots in the foreground at the same viewport and zoom. The normal native-frame run measures 48 batches per scenario across three rounds after warmup. The quick run measures 18 batches. Each batch sends one input or twelve inputs in a burst. Both versions receive the same final time in each batch. The standalone pages use the production digital vector fallback, isolated workspace keys and a fixture from the baseline commit. The manifest identifies each source tree and the fixture by SHA-256. Pass `WORKTREE` explicitly to test a frozen copy of pending changes.

The report records actual vector draws, input-handler time, main-thread work in the input handler and drawing callbacks, elapsed time from dispatch to the final vector draw, and elapsed time through the first subsequent synchronous stage layout read. Inputs start immediately after a frame. The elapsed measurements therefore include native frame scheduling for deferred work. The layout read covers style and layout. GPU presentation takes place later. The raw samples and viewport, stage size and device pixel ratio accompany the summary. The harness checks the final clock per batch and records a signature of all player positions, ball position, phase and clock label. Geometry implementations can legitimately encode different raw SVG paths for the same pose.

A stepped-clock run exercises the same full editor listeners while controlling when callbacks run. In Node it uses happy-dom, which does not rasterize or implement browser layout. Run each version separately, preferably on an idle machine.

```sh
node scripts/bench-digital/editor/node.mjs ../editor-qa/dist/baseline > /tmp/editor-before.json
node scripts/bench-digital/editor/node.mjs ../editor-qa/dist/candidate > /tmp/editor-after.json
node scripts/bench-digital/editor/compare.mjs /tmp/editor-before.json /tmp/editor-after.json
```
