# Full editor timeline benchmark

Use a dedicated QA origin. From the checkout, prepare two frozen versions of the editor and run the production timeline input handler against the same 22-player Mesh play.

```sh
node scripts/bench-digital/prepare-editor.mjs aad1cf6 HEAD ../editor-qa
python3 -m http.server 8000 --directory ../editor-qa/dist
```

Open the index page in desktop Chromium. Run both snapshots in the foreground at the same viewport and zoom. The normal native-frame run measures 48 batches per scenario across three rounds after warmup. The quick run measures 18 batches. Each batch sends one input or twelve inputs in a burst. Both versions receive the same final time in each batch. The standalone pages use the production digital vector fallback, isolated workspace keys and a fixture from the baseline commit. The manifest identifies each source tree and the fixture by SHA-256. Pass `WORKTREE` explicitly to test a frozen copy of pending changes.

Use `toLayoutMs` to compare end-to-end latency across scheduling strategies. It runs from the first input until the final vector draw, the remainder of its handler or callback and a synchronous stage layout read have completed. The report also records actual vector draws, time to the final draw and time spent inside the vector renderer. The diagnostic `activeMs` covers input handlers and drawing rAF callbacks only. A separate microtask or timer can run presentation work outside those intervals. Inputs start immediately after a frame. The elapsed measurements therefore include native frame scheduling for deferred work. The layout read covers style and layout. GPU presentation takes place later. The raw samples and viewport, stage size and device pixel ratio accompany the summary. The harness checks the final clock per batch and records a signature of all player positions, ball position, phase and clock label. Geometry implementations can legitimately encode different raw SVG paths for the same pose.

A stepped-clock run exercises the same full editor listeners while controlling when callbacks run. In Node it uses happy-dom, which does not rasterize or implement browser layout. Run each version separately, preferably on an idle machine.

```sh
node scripts/bench-digital/editor/node.mjs ../editor-qa/dist/baseline > /tmp/editor-before.json
node scripts/bench-digital/editor/node.mjs ../editor-qa/dist/candidate > /tmp/editor-after.json
node scripts/bench-digital/editor/compare.mjs /tmp/editor-before.json /tmp/editor-after.json
```

Reload each snapshot before repeating a cross-version comparison so both runs start in the initial formation.
