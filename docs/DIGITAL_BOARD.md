# Traditional and digital board modes

## Viewing preference

- `传统模式` is the default. Flat SVG symbols, solid interface surfaces, no decorative animation. Playback, speed, scrubbing, editing and exports remain functional.
- `数字化模式` is an explicit desktop choice. It enables the existing liquid interface material and particles plus the digital board renderer.
- Phones and iPads cannot select digital mode. Detection includes mobile/tablet user agents, User-Agent Client Hints, touch-enabled Mac identity used by desktop-site iPads, and coarse/no-hover devices. Window width alone does not misclassify a narrow desktop browser.
- The preference lives under `playbook-visual-mode` in local storage. It is absent from shared playbooks, JSON backups and cloud writes. Mode changes preserve selection, drafts, playback time, zoom and history.
- Reduced motion stops decorative movement while retaining digital materials. Page hiding stops render frames. Stale asynchronous startups are disposed.

## Materials and geometry

The desktop board lazily loads the pinned MIT-licensed Three.js 0.186.0 and `MeshTransmissionMaterial` from `@pmndrs/vanilla` 1.25.0. Both are self-hosted with upstream licenses. No React migration or external HDR/CDN request is needed.

An orthographic camera maps the existing 1000 × 800 SVG coordinates to beveled circular, square and triangular chips. Each chip has a reflective metal base, team-colored insert, transmissive glass cap and contact shadow. Procedural studio softboxes provide the environment reflection. Drag/hover lift affects the material and shadow; gameplay coordinates still come exclusively from the shared model. SVG labels, selection rings and input targets stay above the canvas.

A separate render target captures the field and routes plus opaque chip components before the glass pass. The visible canvas is transparent. This is explicit background sampling, not an assumption that WebGL can read underlying DOM pixels. The SVG field supplies the background texture; stale image decodes cannot replace a newer theme/geometry snapshot.

SVG feedback uses the same playback time for moving route highlights, player/ball trails, block-end pulses, catching rings and coverage contours. Pause and scrubbing are deterministic. A block-only player follows its block path; when a primary running route exists it retains precedence. This does not simulate collisions or infer a successful block.

When the selected holder has a non-optional drawn passing route and a receiver, its bends are retained and its endpoints are adjusted to release/catch positions. Rehearsal draws this same adjusted path. No receiver or no drawn pass retains the existing ball behavior. Coverage remains manually drawn defensive coverage, not a computed probability region.

## Export and failure behavior

- Digital PNG captures the material layer and SVG feedback with the current playback position; clear labels are composited above it.
- SVG and printed playbooks retain a portable flat vector representation. JSON contains editable geometry, without device preferences.
- Reference-image Madden plays remain reference images.
- If WebGL initialization, context or shader rendering fails, the SVG players and input layer remain available, route feedback continues, and a visible notification explains the fallback. A mode switch can retry. The UI never claims that the fallback has a rendered glass material.

## Validation — 2026-10-25

- `npm run check`, `npm run typecheck`, `npm test`: passed (116 tests).
- Added coverage for desktop-site iPad restrictions, default/persisted modes, storage-write failures, obsolete renderer startups, renderer recovery, unchanged play geometry, block timing, curved pass endpoints, scrubbing, theme remounts and WebGL-unavailable fallback.
- Both actual material shader variants were expanded with Three.js r186's `WebGLProgram` and compiled/linked as GLSL ES 3.0 using Mesa llvmpipe through a standalone EGL context. No shader-source compatibility translation was required.
- Browser checks confirmed mode persistence, preserved paused playback time, retained yard lines and players after theme changes, WebGL failure recovery, and the PNG download event.
- The cloud preview browser reports WebGL disabled. Hardware browser rendering, final glass appearance and physical iPhone/iPad behavior are not visually verified by this run. DOM/device-policy tests and the shader check do not substitute for those checks.

![Traditional mode and the mode selector](assets/v4-mode-switch.jpg)

## Upstream references

- https://github.com/mrdoob/three.js/tree/r186
- https://threejs.org/docs/pages/MeshPhysicalMaterial.html
- https://github.com/pmndrs/drei-vanilla
- https://github.com/pmndrs/drei-vanilla/blob/main/.storybook/stories/MeshTransmissionMaterial.stories.ts
