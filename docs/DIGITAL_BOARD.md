# Traditional and digital board modes

## Viewing preference

- `传统模式` is the default. Flat SVG symbols, solid interface surfaces, no decorative animation. Playback, speed, scrubbing, editing and exports remain functional.
- `数字化模式` is an explicit desktop choice. It enables the existing liquid interface material and particles plus the digital board renderer.
- Phones and iPads cannot select digital mode. Detection includes mobile/tablet user agents, User-Agent Client Hints, touch-enabled Mac identity used by desktop-site iPads, and coarse/no-hover devices. Window width alone does not misclassify a narrow desktop browser.
- The preference lives under `playbook-visual-mode` in local storage. It is absent from shared playbooks, JSON backups and cloud writes. Mode changes preserve selection, drafts, playback time, zoom and history.
- Reduced motion stops decorative movement while retaining digital materials. Page hiding stops render frames. Stale asynchronous startups are disposed.

## Digital coaching table

Choose **Display mode → Digital** on a desktop. Click **Toggle field brightness** (the sun above the field) to switch between dark graphite and cool silver. The yard lines, short hash marks and dashed line of scrimmage use different weights on both surfaces. The offense uses light puck faces and the defense uses dark faces. The edge band carries the player’s color, and a broken ring marks the selected player even when both teams share a color.

![The same Mesh play on dark graphite and cool silver fields](assets/readme/digital-field-themes.webp)

The editor loads its pinned Three.js r186 module on demand. The GPU scene and the SVG compatibility renderer build the pucks from the same profile. The fixed camera uses 50° elevation and a 42° field of view. The accessible SVG hit targets use its ground-plane projection, and the GPU picker also tests the elevated pieces. The field and players keep their model coordinates when the user zooms, scrolls or switches display modes.

The field is a textured mesh with projected shadows. The opaque pieces take one scene submission per draw. A retained 2000 × 1600 field texture contains the markings and route geometry. The editor can move an independent player without rebuilding the field texture. A changed route invalidates the texture. A paused or idle board sleeps once outstanding texture and interaction work finishes.

The selected route or player’s routes receive a local highlight. In rehearsal, the underlying routes, optional dashes, arrowheads and block end caps remain visible. Release and catch feedback use the editor’s playback time, so moving the timeline backwards replays the same event. Reduced motion keeps a fixed receiver indicator. Pass and block geometry comes from the same football model used by the flat editor.

[Acceptance cases](DIGITAL_BOARD_ACCEPTANCE.md) · [Repeatable measurements](DIGITAL_BOARD_PERFORMANCE.md)

## Export and failure behavior

- With WebGL ready, digital PNG exports the complete current 3D scene, including the camera view, field, routes, pieces, labels, shadows and football. The scene is not projected again or overlaid with duplicate SVG players.
- When WebGL is unavailable, an independent CPU mesh renderer projects piece vertices into SVG using the same perspective camera. It draws the shared puck profile with projected faces, contact shadows, labels and a selection ring.
- Compatibility-view PNG explicitly exports a flat diagram, including the current playback geometry and route feedback. The export dialog states this difference.
- SVG and printed playbooks retain a portable flat vector representation. JSON contains editable geometry, without device preferences.
- Reference-image Madden plays remain reference images.
- If WebGL initialization, context or shader rendering fails, the perspective compatibility renderer and input layer remain available, route feedback continues, and a visible notification explains the fallback. A mode switch can retry.

## Historical v4.2 validation — 2026-10-25

- `npm run check`, `npm run typecheck`, `npm test` (150 tests), and the production build passed.
- Real Three scene lifecycle tests retain geometry, materials, camera and raycaster while replacing GPU submission; both actual material shaders with the PCF shadow branch compile and link as GLSL ES 3.0 in Mesa EGL.
- Browser checks confirmed raised-head selection, dragging and undo, traditional-mode cleanup, theme switching, and deletion at 150% retaining scrollLeft=82, scrollTop=269 and pageTop=214.
- Regression coverage checks camera projection and inverse input, raised piece geometry, stage sizing from 100% to 300% and back, traditional/digital/reference transitions, preserved scroll offsets after deletion and history operations, and complete-scene versus compatibility PNG export behavior.
- The cloud preview browser reports WebGL disabled. The compatibility screenshot below shows the perspective layout and CPU-rendered pieces. It is not evidence of GPU rendering, physical glass refraction, shadow-map quality or the final hardware appearance.
- Hardware-browser visual validation of the Three.js scene and physical iPhone/iPad testing remain incomplete. Numerical projection tests and automated checks do not substitute for those checks.

![v4.2 perspective compatibility view — WebGL disabled](assets/v42-board-perspective.jpg)

## Historical v4.2.1 route-edit continuity

Editing a route no longer replaces the live board stage or SVG root. Selection, inspector changes, point commits and undo/redo reconcile the same mounted scene; feedback and compatibility pieces update synchronously before the next paint. The Three renderer retains its last complete texture while the replacement SVG image decodes, then swaps a fully rasterized spare canvas atomically. Failed and superseded decodes cannot blank the field or overwrite a newer mounted play. Compatibility remounts retain the existing piece overlay and picking bounds.

Regression coverage checks retained stage/SVG/canvas identity, synchronous feedback updates, compatibility remount continuity, delayed/out-of-order decoding and rasterization failures. All 157 tests, syntax checks and TypeScript checks pass. Browser checks covered route type changes, committed duration edits, node dragging, undo and redo with all 11 pieces and 92 yard lines retained. Hardware WebGL pixel verification remains subject to the limitation documented above.

![Route edit compatibility-view verification](assets/v421-route-edit.jpg)

## Original v4.0 validation — 2026-10-25

- `npm run check`, `npm run typecheck`, `npm test`: passed (116 tests).
- Added coverage for desktop-site iPad restrictions, default/persisted modes, storage-write failures, obsolete renderer startups, renderer recovery, unchanged play geometry, block timing, curved pass endpoints, scrubbing, theme remounts and WebGL-unavailable fallback.
- Both actual material shader variants were expanded with Three.js r186's `WebGLProgram` and compiled/linked as GLSL ES 3.0 using Mesa llvmpipe through a standalone EGL context. No shader-source compatibility translation was required.
- Browser checks confirmed mode persistence, preserved paused playback time, retained yard lines and players after theme changes, WebGL failure recovery, and the PNG download event.
- The cloud preview browser reports WebGL disabled. Hardware browser rendering, final glass appearance and physical iPhone/iPad behavior are not visually verified by this run. DOM/device-policy tests and the shader check do not substitute for those checks.

![Traditional mode and the mode selector](assets/v4-mode-switch.jpg)

## Upstream references

- https://github.com/mrdoob/three.js/tree/r186
- https://threejs.org/docs/pages/MeshPhysicalMaterial.html
- https://threejs.org/docs/pages/PerspectiveCamera.html
- https://threejs.org/docs/pages/Raycaster.html
- https://github.com/pmndrs/drei-vanilla
- https://github.com/pmndrs/drei-vanilla/blob/main/.storybook/stories/MeshTransmissionMaterial.stories.ts

## Historical v4.1 refinement — superseded by v4.2

The following records the previous implementation and its validation. Its orthographic/affine rendering, growing zoom gutters and projected SVG PNG path have been replaced by the v4.2 architecture above; the scroll and component-spacing fixes remain.

- The complete SVG/canvas board has one fixed affine axonometric transform, with a visible plinth and contact shadow. Input uses the inverse SVG screen matrix, preserving placement through skew, zoom and scrolling. Traditional mode and reference images stay flat.
- Zoom gutters grow with projected width, so every corner remains reachable at 300% without feeding padding back into the zoom calculation.
- Deleting routes and undo/redo restore nested board scroll offsets after restoring zoom dimensions.
- Digital PNG exports bake the same projection into a standalone SVG before rasterization; shared geometry and ordinary SVG/print exports remain unchanged.
- Panel/control/inset radii follow a consistent scale. Edge-to-edge sidebar/header surfaces meet without scalloped corner gaps; tool indicators use the same inset and cell widths as their buttons.
- Regression coverage includes ground-plane registration, vertical thickness, inverse input matrices, scroll restoration, zoom gutter stability and PNG bounds.
- The preview browser still disables WebGL. The 2.5D layout is visually inspected in fallback mode; both updated material shaders compile/link as GLSL ES 3.0 in Mesa EGL. Final hardware-rendered glass appearance remains unverified.

References: https://threejs.org/docs/pages/OrthographicCamera.html and https://threejs.org/docs/pages/ExtrudeGeometry.html.

Validation: 135 tests, syntax checks and TypeScript checks passed. Browser deletion at 150% kept scrollLeft=112, scrollTop=201, pageTop=215 unchanged.


![2.5D layout with WebGL-unavailable fallback players](assets/v41-board-fallback.jpg)
