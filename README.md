# Talk waveforms

A bookmarklet overlay for inspecting Nextcloud Talk audio. It creates a separate analyser for every incoming WebRTC audio track, then associates Talk's rendered media elements with those tracks to recover participant names.

## Install

Open [silvio-talk-waveforms.pgs.sh](https://silvio-talk-waveforms.pgs.sh/) and drag **Talk waveforms** to the browser's bookmarks bar. Open a Talk call and click the bookmark before joining for source-level WebRTC capture.

The overlay provides four views:

- live waveform
- 15-second amplitude history
- live frequency spectrum
- scrolling speech-band spectrogram

Local microphone capture is tagged `LOCAL · CAPTURE`; incoming participant tracks are tagged `REMOTE · WEBRTC`. A media-element scan remains as a late-injection fallback.

## Files

- `nctalk-waveform.0.2.0.js` — versioned overlay payload
- `bookmarklet-loader.js` — CSP-aware bookmarklet; loads the PGS asset with Nextcloud's nonce
- `site/` — minimal installation homepage
- `tests/smoke.spec.js` — real Nextcloud CSP plus WebRTC loopback test
- `tests/harness.spec.js` — four-browser Nextcloud Talk/Janus integration test
- `tests/homepage.spec.js` — deployed installer and clipboard test

## Test

```sh
npm install
npm run test:local
```

The local test opens `https://cloud.codemyriad.io/call/erwcr27x`, serves the checked-out payload through request interception, creates a WebRTC audio loopback, and verifies remote-track separation, signal analysis, history/spectrogram rendering, reload cleanup, and hook restoration.

After deployment, `npm test` repeats the same checks against the actual PGS-hosted asset.

For the full multi-participant integration test, start the sibling Gocassini stack and create a room:

```sh
../gocassini/bin/cassini dev stack up --services full --recording-backend none
npm run test:harness
```

The test creates a fresh room, then runs one observer and three real Chrome Talk participants. Each participant publishes the harness speech fixture; the assertion is made at the observer's WebRTC receiver boundary. The recorder-oriented Go player is not used because it does not implement Talk's browser `requestoffer` subscription flow.

## Deploy

```sh
npm run deploy
```

This adds or updates the four public assets in the authenticated `pgs.sh:/talk-waveforms/` project without deleting unrelated remote files.
