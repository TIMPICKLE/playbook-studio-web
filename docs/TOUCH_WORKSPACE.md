# iPhone and iPad workspace

The editor keeps the field central and opens the playbook and properties on demand.
Compact layout applies below 1181 CSS pixels, and through 1400 pixels when any
available pointer is coarse. This keeps large iPads in the touch workspace when a
trackpad is attached, while fine-pointer desktops retain their columns.

## Interaction

- Drag a player, route control point, zone or annotation with one finger.
- Empty turf in Select mode permits native scrolling/panning and browser pinch zoom.
- The field zoom buttons remain independent of document zoom.
- A second finger cannot take ownership of an edit. Cancellation, lost pointer
  capture, app blur, backgrounding or rotation rolls back the unfinished movement.
- AI on touch devices opens in a viewport layer so the field cannot clip it.
- Properties, Madden and roster dialogs use the visible viewport and safe areas.
  Long forms and short landscape screens retain scrollable content and actions.
- Compact language selection lives in the page footer so it cannot obscure the
  fixed playbook / field / properties navigation.

## Verification

Automated checks cover route endpoint dragging, pointer ownership, final-sample
commit, cancellation rollback, orientation, large iPad plus trackpad layout,
focus return, AI portal lifecycle, Madden preview scroll restoration and
keyboard viewport sizing. Existing editing, import, undo, roster and AI tests
remain part of the full suite.

Browser layout review uses actual Chromium rendering in sized preview frames:
320×568, 390×844, 844×390, 768×1024, 1024×768 and desktop sizing. This verifies
layout and browser interaction; it does not substitute for physical iOS Safari
or Apple Pencil testing. Software keyboard viewport changes and mixed pointer
capabilities are covered by DOM integration tests.

The compound media conditions target Safari 16.4+ and current browsers; WebKit
introduced Media Queries Level 4 Boolean syntax in
[Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/).
The project already relies on modern features including dynamic viewport units,
`:has()` and native dialog.
