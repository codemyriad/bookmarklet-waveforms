# Showcase participant images

These portraits provide speaking and listening camera feeds for Albert Einstein, Marie Curie, Ernest Rutherford, Paul Langevin, and Henri Poincaré. The showcase seed chooses one speaker and three listeners reproducibly; change `SHOWCASE_SEED` to rotate the cast and roles.

Run the real Talk capture with:

```sh
npm run test:showcase
```

Each still is converted to a short Y4M camera feed and published by a separate real browser participant. The PNGs are stored with Git LFS. For ordinary compatibility tests, missing portraits fall back to Nextcloud avatars.
