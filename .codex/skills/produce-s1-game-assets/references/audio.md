# Audio Lane

Use this lane for `audio.clinic.core-sfx-01` and `audio.clinic.bgm-day-01`.

## Tool ownership

- Source: project-owner recording/composition, clearly licensed CC0/CC BY material, or an AI generation provider whose model/version and commercial terms are recorded.
- Editing/mastering: Audacity MCP for trim, cleanup, gain, fades, loop preparation and export.
- Generation: fal.ai only when `FAL_KEY` is configured and the selected model's commercial use and output terms are acceptable. Keep prompts and generation metadata.
- Runtime verification: browser playback after a user gesture, independent music/SFX controls, desktop and Android smoke.

Never use real patient voice/name, branded device recordings, protected music fragments, startling alarms, comic medical sounds, or an untraceable sample/loop.

## Core SFX

Asset ID: `audio.clinic.core-sfx-01`.

Required event set:

- door chime;
- computer interaction;
- patient call/queue;
- indoor footsteps;
- sitting;
- curtain;
- drawer open and close;
- thermometer handoff;
- ordinary exit and angry exit;
- coins, reputation, purchase, upgrade, unlock and error.

Desired impression: light, warm and restrained. Every important action receives a clear state cue without interrupting reading. Error feedback must not startle.

Candidate master/runtime specification pending H3:

- editable WAV master, 48 kHz/24-bit candidate;
- mono for UI/footsteps; stereo only for true ambience;
- one-shot duration about 0.1–1.2 seconds;
- WebM Opus plus AAC/MP3 fallback candidate;
- short-SFX loudness candidate −20 to −16 LUFS integrated, true peak no higher than −1 dBTP;
- restrained variants are allowed when they reduce repetition.

Prompt pattern for generated candidates:

```text
One isolated short sound event: <event>. Warm, soft, restrained community-clinic game feedback, clean tail, no music, no speech, no name, no brand, no medical alarm, no comedy, no background noise. Suitable for a quiet reading-focused mobile game.
```

Acceptance: events remain distinguishable on phone speakers at low volume; none masks dialogue or feels alarming; first-gesture unlock works; source and rights records are complete.

## Daytime clinic BGM

Asset ID: `audio.clinic.bgm-day-01`.

Deliver one daytime clinic theme only; do not create a separate title/menu theme for MVP.

Desired impression: warm, professional, restrained and comfortable under prolonged Chinese reading, with no emergency tension.

Preserve:

- instrumental only, with no voice;
- one seamless 60–120 second loop candidate;
- music default volume below interaction SFX;
- independent music volume/mute;
- playback only after a clear user gesture;
- exact sample loop boundary with short entrance/exit fades and no click at repeat.

May vary instrumentation, tempo and gentle within-track variation. Avoid strong drums, protected melody resemblance, medical alarm samples, comedy, horror-hospital atmosphere or a conspicuous cadence at each loop.

Candidate master/runtime specification pending H3: DAW project when applicable, stems plus 48 kHz/24-bit stereo WAV master, WebM Opus plus AAC/MP3 fallback, −20 to −16 LUFS integrated and true peak no higher than −1 dBTP.

Prompt pattern for generated candidates:

```text
Instrumental seamless loop for a warm daytime community clinic in a reading-focused simulation game, 60–120 seconds. Professional, calm, gentle light arrangement, subtle internal variation, no vocals, no recognizable melody, no strong drums, no alarm or hospital sample, no comedy or horror, sample-accurate loop ending.
```

Acceptance: a 10-minute continuous playback check has no audible click/gap or obvious loop fatigue; music does not mask Chinese reading or SFX; desktop and Android playback are clean; every composition/sample has traceable rights.
