# Talk waveforms

A bookmarklet that lets you see the sound from your microphone and from every other participant in a Nextcloud Talk or Jitsi Meet call. It helps answer practical questions: can everyone hear the fan beside me, and whose microphone picked up that bark?

## Install

Open [silvio-talk-waveforms.pgs.sh](https://silvio-talk-waveforms.pgs.sh/) and drag **🌊 Talk** to the browser's bookmarks bar. Open a Nextcloud Talk or Jitsi Meet call, then click the bookmark. Loading it before joining gives the most reliable participant separation.

Every participant card gets an independent overlay. Its button cycles through four views:

- live waveform
- 15-second level history
- live frequency spectrum
- persistent 15-second spectrogram

Each graph can be collapsed and reopened. Spectrogram history continues while another view is selected, but painting is limited to visible overlays. Analysis is rate-limited to keep the call page light: level samples run at 20 Hz and spectrogram samples at 10 Hz.

## How it works

On Nextcloud Talk, local and remote lanes come from the browser's WebRTC sender and receiver tracks. On Jitsi Meet, they come from Jitsi's participant-tagged media tracks. Both paths analyze the same streams the call uses, without opening the microphone a second time. A DOM media-element scan handles late loading and card association on Talk.

## Files

- `talk-waveforms.0.4.0.js` — versioned visualization payload
- `bookmarklet-loader.js` — bookmarklet loader for Nextcloud Talk and Jitsi Meet
- `site/` — installation homepage and generated harness screenshots
- `tests/smoke.spec.js` — strict-CSP fixture and WebRTC sender/receiver loopback test
- `tests/harness.spec.js` — multi-browser Nextcloud Talk integration test
- `tests/jitsi-harness.spec.js` — multi-browser Jitsi integration test and showcase capture
- `tests/participant-images/` — Git LFS-backed generated camera feeds
- `.github/workflows/ci.yml` — fixture, Jitsi, and past/current/future Talk compatibility tests

## Test

Install the JavaScript dependencies and run the fast local fixture:

```sh
npm install
npm run test:fixture
```

The fixture verifies loader behavior under a strict nonce-based CSP, local-track deduplication, remote-track separation, participant-card placement, all four modes, persistent history, collapse/reopen behavior, click isolation, cleanup, and hook restoration.

For the full Nextcloud integration test, start the sibling Gocassini stack:

```sh
../gocassini/bin/cassini dev stack up --services full --recording-backend none
npm run test:harness
```

The test joins one observer and three real browser participants. CI repeats it against a past, current, and future Nextcloud/Talk combination.

The Jitsi test uses the official `jitsi/docker-jitsi-meet` release pinned in CI (`stable-11146-2`). Start that stack with `tests/jitsi.env`, then run:

```sh
JITSI_URL=http://127.0.0.1:18000/TalkWaveformsHarness npm run test:jitsi
```

It joins one observer and two browser participants and verifies that each Jitsi audio track lands exactly once on its named participant tile. To regenerate the 2560×1600 homepage capture, use the same stack and run `npm run test:jitsi:showcase`. The showcase uses four generated video feeds and synthesized, non-overlapping speech turns; Mary Somerville's room also carries a steady fan tone.

## Deploy

```sh
npm run deploy
```

This updates the versioned payload, loader, homepage, and assets in the authenticated `pgs.sh:/talk-waveforms/` project without deleting unrelated remote files.
