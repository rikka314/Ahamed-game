# UI Lane

Asset ID: `ui.clinic.core-01`.

Use React DOM, CSS Modules/custom properties and original SVG for the core medical and management UI: speech bubbles, computer, run/status strip, touch controls, report paper, diagnosis, scoring, shop, upgrades, errors and recovery.

## Tool ownership

- `$frontend-design`: hierarchy, tokens, responsive layout and implementation quality.
- `$accessibility`: semantics, keyboard/focus, contrast, non-color state, motion and screen-reader behavior.
- Canva or built-in image generation: optional direction/moodboard only; never export medical long text as a flattened image.
- `$browser-qa`: desktop and mobile viewport, focus isolation, safe-area, input and visual verification.

## Preserve

- React DOM for long medical text, forms, dialogs, shop, diagnosis and results;
- semantic controls and keyboard reachability;
- candidate minimum 44×44 CSS px touch targets;
- candidate body text at least 16 CSS px;
- safe-area handling and accessible portrait-orientation guidance;
- speech-bubble collision/avoidance and screen anchoring;
- high contrast, visible focus and text/icon/state redundancy rather than color-only communication;
- modal input isolation so keyboard/touch events do not continue moving the Phaser world.

May vary border, shadow, radius, icon treatment and typography hierarchy within direction A: warm, modern, professional and compatible with the pixel world.

Forbidden: pixel fonts for long Chinese text, Canvas-rendered long text, baked Chinese in PNG, low-contrast gray text, color-only status, external product UI copying, or icons with unclear rights.

## Deliverables

- design-token updates using CSS custom properties;
- focused TSX/CSS Module changes rather than a second UI framework;
- original or clearly licensed SVG icons;
- font license record if adding WOFF2; prefer the existing system Chinese fallback when no font is required;
- browser evidence for desktop and mobile landscape, plus accessible portrait guidance;
- manifest/provenance only for actual external runtime assets, not ordinary project-authored CSS.

## Acceptance

- readable on desktop and phone landscape at real scale;
- keyboard reachable with logical focus order and visible focus;
- touch targets and safe-area verified, not inferred from source code alone;
- dialog/modal input does not leak to the world;
- portrait guidance is perceivable and dismissible/usable as designed;
- no medical text or state depends on Canvas pixels or color alone.
