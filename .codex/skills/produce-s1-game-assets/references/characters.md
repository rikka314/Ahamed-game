# Character Lane

Use this lane for the playable doctor and three public patient-personality archetypes.

## Shared character contract

- Same orthographic view, pixel density, frame grid, baseline, direction order, and transparent padding across doctor and patients.
- H3 candidates are 16×24 or 32×48 per frame; do not mix sizes in one build.
- Candidate foot point is normalized `(0.5, 1.0)` with a narrow foot collision body. The full body is not a collision rectangle.
- Candidate walk cycles use 4–6 frames at 6–10 FPS. H3 must freeze exact reuse, direction order, frame count, FPS and anchor offsets.
- sRGB, alpha, no anti-aliasing. Check silhouettes at actual mobile gameplay scale, not only editor zoom.
- Runtime output is a transparent PNG spritesheet plus explicit JSON metadata. Editable source is `.aseprite` when licensed Aseprite is available, otherwise a lossless layered source that can be handed off safely.
- Generated images are direction candidates. Clean the grid, palette, anatomy, frame alignment and transparent padding before integration.

Recommended tool order: PixelLab or built-in image generation for a small direction sheet → Aseprite/LibreSprite cleanup → fixed-grid export → metadata and Phaser animation validation.

## Playable doctor

Asset ID: `sprite.doctor.player-01`.

Desired impression: professional, calm and approachable, not a superhero or mascot.

Required states:

- four-direction `idle` and `walk`;
- consultation `sit`, aligned to `anchor.doctor-seat`;
- thermometer sequence poses `drawer-reach`, `handoff-give`, `handoff-receive`, `drawer-store`, using 2–4 restrained frames or reusable poses once H3 freezes the scheme.

Preserve a consistent body volume and foot point in every direction. The seated pose must align with the existing seat anchor; handoff poses must align with drawer and patient anchors.

May vary: hair, local uniform/white-coat details and respectful skin-tone candidates. Avoid diagnosis props, exaggerated expressions, gender stereotypes, cape/hero language, mascot proportions, and direction-to-direction body drift.

Runtime naming: `doctor-{state}-{direction}-{frame}`.

Prompt seed:

```text
Orthographic top-down pixel character turnaround for a calm, approachable community-clinic doctor. Consistent body proportions and foot point in four directions; neutral professional uniform with restrained white-coat details; idle, walk and believable seated consultation pose. Include small handoff pose ideas for retrieving and passing a digital thermometer. Same grid and silhouette in every direction, diverse and non-stereotyped, no diagnosis prop, no text, no logo, no watermark, no mascot or superhero styling.
```

Acceptance: four-direction proportions/foot point do not drift; seat alignment is credible; doctor remains identifiable at phone scale; no stereotype or hidden medical clue.

## Three-patient starter set

Asset ID: `sprite.patient.starter-set-01`.

Deliver three respectful, visually distinguishable public personality archetypes. A gameplay day may instantiate only two queued patients, but the source set contains all three.

Required states for each archetype:

- queue/waiting `idle`;
- four-direction `walk`;
- consultation `sit`;
- ordinary exit and angry exit, with anger readable but never humiliating or comic;
- thermometer poses `thermometer-receive`, `thermometer-measure`, `thermometer-return`.

May vary age range, skin tone, hair, everyday clothing and palette while keeping equal respect and visual quality. Public personality can read through posture, clothing rhythm and restrained motion, but appearance must never reveal diagnosis, symptoms, hidden case facts, or clinical severity.

Forbidden: disease stereotypes, branded clothing, exaggerated weakness, slapstick illness, sexualization, only red/blue gender coding, or a grotesque angry-exit animation.

Runtime naming: `patient-{public-id}-{state}-{direction}-{frame}`. `public-id` must be a stable presentation ID, not a private case ID or diagnosis label.

Prompt seed:

```text
Three diverse adult community-clinic patient archetypes in orthographic top-down pixel art, sharing the exact same frame grid and scale as the doctor. Distinct everyday clothing, age cues and restrained public personality through posture; four-direction movement, waiting and seated consultation pose ideas. Respectful and realistic, no diagnosis-revealing appearance, no exaggerated weakness, no brand, no text, no logo, no watermark, no gender color stereotype.
```

Acceptance: all three archetypes are distinguishable without diagnosis leakage; grid and seat/foot anchors do not drift; angry exit preserves patient dignity; queue silhouettes remain readable without crowding.
