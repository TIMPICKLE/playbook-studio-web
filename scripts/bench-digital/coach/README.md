# Coach Film performance trial

Prepare a static QA copy from the checkout. Use a fresh directory on a dedicated QA origin, served with the project's normal preview workflow.

```sh
node scripts/bench-digital/coach/prepare.mjs ../coach-film-qa
```

The prepared site has a `dist` directory and a static hosting manifest. To place it under an existing QA preview, use `--mount <empty-static-subdirectory>` and open the benchmark relative to that subdirectory. The copy has isolated workspace, onboarding and visual-mode keys. No benchmark driver is shipped with the editor.

| Open on the preview origin | Sampling |
| --- | --- |
| `film-clock.html?run=1` | Empty static page, three fifteen-second batches of bare native rAF, with no editor, stylesheet, WebGL, input, or DOM work in the sampling loop |
| `film-entry.html?run=1` | Normal editor startup, automatic full trial. The seed page saves the 22-player scene and navigates to `index.html#editor`. After ordinary application load, font readiness and a subsequent task, the recorder tests the visible entry, two idle clock stages, three 30-second playing rounds and seek latency. |
| `film-profile.html?run=1#editor` | Optional six-stage paired profile in one document. Records callback wall-clock execution, long-animation-frame entries where supported, and native frame cadence during each eight-second phase |
| `film-profile.html?isolate=1&run=1#editor` | Measure the editor shell, stylesheets, runtime and field separately using the same native rAF probe. A 32 ms timer samples event-loop progress. When switching off styles restores the frame rate, the profiler tests groups of stylesheets to locate the cause. |
| `film-style.html?run=1` | Navigate the same foreground tab through a fresh top-level HTML document per case. Compare blank controls, 24 empty external files, fetch-only requests, parser-linked real styles, dynamically linked styles, the two stylesheet halves, one bundled link and one inline style. The test follows the first slow half when empty controls remain fast. |
| `film-bench.html?run=1#editor` | Full trial with normal renderer selection |
| `film-bench.html?renderer=svg&run=1#editor` | Full trial forcing the SVG fallback |
| `film-bench.html?quick=1&run=1#editor` | Short smoke test of the measurement workflow |

Run the clock and both renderers in sequence in the same foreground tab at 100% zoom. Record hardware, browser, monitor refresh rate and power mode. Use 60 Hz for the proposed desktop thresholds (about 16.7 ms per refresh). If the blank page itself is throttled, retain the three clock samples with the workload and repeat on the target machine before applying a 60 Hz pass/fail gate. Similar P95 values across different sampled pages do not measure per-frame rendering cost. A browser trace separates CPU/GPU work from waiting for a display tick. To build a reproducible baseline for the next release, save the full exported JSON for each trial.

The harness enters the full editor, opens coach film with its ordinary title button, then focuses H and Y in the repository's fixed 22-player Mesh scene. After warmup it runs three thirty-second trials. It loops the six-second play through the public transport and dispatches 32 alternating forward/backward range inputs per trial. Each input is timed until a native animation frame observes the matching field commit. It also observes field DOM mutations and available WebGL draw/clear calls for ten seconds after settling. Hidden tabs invalidate a run.

The displayed summary includes frame interval P50/P95/max, percentage over 33.3 ms, model seconds advanced, input-to-observed-frame P50/P95/max, viewport, DPR and source hashes. The driver verifies 22 rendered actors, ten model routes, and the two focus players. It rejects stalled playback, a change of renderer, and backgrounded samples. A failed rerun clears the old result. Download the JSON for individual samples. Native animation-frame cadence and commit observation are proxies. The browser's GPU/compositor trace on a physical reference machine is required for final presentation latency and frame-drop claims. Force-SVG tests have no WebGL idle counter to sample.

The paired profile starts with empty HTML, mounts the ordinary editor in traditional mode, switches the underlying editor to digital mode, opens the room paused, plays the scene, and finally repeats playback with the covered editor subtree temporarily made invisible. The final isolation phase changes only the diagnostic page. The sampler bypasses its own rAF wrapper and records product callbacks by function name. Field input dispatch and subsequent observed frame time are reported separately. Source animation-frame callbacks can complete quickly even when rasterization, compositing, or browser scheduling delay presentation.

The fresh-document test starts with `film-style.html?run=1` and ends automatically on `film-style.html`, which displays the results and offers a JSON download. `mode=external`, `mode=inline`, `mode=bundle`, `mode=empty` or `mode=dynamic` limits a run to the selected case between two blank controls. Test state lives only in the tab's session storage. URLs contain case identifiers. Each stage records its own navigation time origin, stylesheet count, visibility, native rAF cadence and ordinary timer interval.

The normal-startup copy preserves the original parser-linked styles and application module in `index.html`. One QA-only deferred listener waits for load and fonts before importing the measurement driver. `app.js` matches the checkout byte for byte. The QA service worker handles no requests and the prepared storage keys are isolated. The normal startup trial defaults to the ordinary traditional editor backdrop. Add `visual=digital` to start with the editor's digital preference, `renderer=svg` to force only the subsequently opened film renderer to SVG, or `quick=1` for a smoke test.
