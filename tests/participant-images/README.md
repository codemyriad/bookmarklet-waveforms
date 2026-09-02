# Showcase participant images

These portraits provide speaking and listening camera feeds for Albert Einstein, Marie Curie, Ernest Rutherford, Paul Langevin, and Henri Poincaré. The showcase seed chooses one speaker and three listeners reproducibly; change `SHOWCASE_SEED` to rotate the cast and roles.

Run the real Talk capture with:

```sh
npm run test:showcase
```

Each still is converted to a short Y4M camera feed and published by a separate real browser participant. The PNGs are stored with Git LFS. For ordinary compatibility tests, missing portraits fall back to Nextcloud avatars.

The versioned `0.4.0` portraits form a second set for the automated Jitsi
showcase. They are deliberately fictional raw camera feeds:

- Ada Lovelace speaks from a laptop webcam in her study, wearing modern
  over-ear headphones.
- Alan Turing listens through a slightly low, too-close phone front camera.
- Hypatia listens through a clean desk webcam in an Alexandrian study.
- Mary Somerville listens on wired earbuds; the visible desk fan supplies the
  continuous low-frequency hum shown in her spectrogram.

They use contemporary digital camera perspective and color, not an archival
or analog-film treatment. Jitsi provides the surrounding interface in the
final screenshot.

The versioned `0.5.0` set stages a restrained Microsoft Teams conversation
about Caesar's calendar reform:

- Sosigenes speaks from an Alexandrian study; his sundial is subtly wrong.
- Julius Caesar listens from a campaign office; a squeezed-in tally mark hints
  at the leap day.
- Cleopatra listens by phone from Alexandria; her headphone cable makes a
  loose serpentine curve.
- Cicero listens from a crowded study; a thin thirteenth tablet is wedged next
  to twelve thicker ones.

All four prompts asked for photorealistic 2020s webcam or phone-front-camera
frames, digital compression and imperfect auto-exposure, historically grounded
rooms and clothing, no call UI, no readable text, and no analog-film treatment.

The Google Meet set imagines an 1843 conversation about whether the Analytical
Engine could compose music:

- Ada Lovelace speaks from a study with a punched-card music box.
- Charles Babbage listens beside the Difference Engine; one gear resembles a
  musical note.
- Mary Somerville listens in a daylight study with a subtle wave drawing.
- Michael Faraday listens from his laboratory, where a loose copper wire curls
  like a treble clef.

These were generated as raw, photorealistic 16:9 laptop-webcam feeds: modern
headsets, natural digital camera noise and compression, safe space along the
lower edge for overlays, and no platform UI, captions, logos, readable text,
sepia, film grain, or costume-drama lighting. Capture the final 2560×1600 Google
Meet composition with `npm run test:google:showcase`.
