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
