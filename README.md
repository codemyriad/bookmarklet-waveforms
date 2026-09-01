# Talk waveforms

A bookmarklet overlay for inspecting Nextcloud Talk audio. It creates a separate analyser for every WebRTC sender and receiver track, then associates Talk's rendered media elements with those tracks and participant cards.

## Install

Open [silvio-talk-waveforms.pgs.sh](https://silvio-talk-waveforms.pgs.sh/) and drag **Talk waveforms** to the browser's bookmarks bar. Open a Talk call and click the bookmark before joining for source-level WebRTC capture.

Every participant card gets its own visualization and mode button. The toolbar can be collapsed without destroying the analysers; a persistent pill reopens it. Each lane provides four views:

- live waveform
- 15-second amplitude history
- live frequency spectrum
- scrolling speech-band spectrogram

The local lane is taken from Talk's actual `RTCRtpSender` track and remote lanes from `RTCRtpReceiver` tracks. This avoids a second microphone capture and permission prompt. **Mic test** is an explicit fallback only when no outgoing Talk track exists. A media-element scan remains as a late-injection and participant-card association fallback.

## Files

- `nctalk-waveform.0.3.0.js` — versioned overlay payload
- `bookmarklet-loader.js` — CSP-aware bookmarklet; loads the PGS asset with Nextcloud's nonce
- `site/` — minimal installation homepage
- `tests/smoke.spec.js` — CSP fixture/real Nextcloud plus WebRTC sender-receiver loopback test
- `tests/harness.spec.js` — four-browser Nextcloud Talk/Janus integration test
- `tests/homepage.spec.js` — deployed installer and clipboard test
- `.github/workflows/ci.yml` — fast fixture tests and past/current/future Talk compatibility matrix

## Test

```sh
npm install
npm run test:fixture
```

The fixture test serves a strict nonce-based CSP page and the installer locally, creates a WebRTC audio loopback, and verifies local sender deduplication, remote-track separation, participant-card placement, per-lane modes, collapse/reopen behavior, signal analysis, reload cleanup, and hook restoration.

To repeat that smoke test against the real Nextcloud page, run:

```sh
npm run test:local
```

After deployment, `npm test` repeats the same checks against the actual PGS-hosted asset.

For the full multi-participant integration test, start the sibling Gocassini stack and create a room:

```sh
../gocassini/bin/cassini dev stack up --services full --recording-backend none
npm run test:harness
```

The test creates a fresh room, then runs one observer and three real Chrome Talk participants. It verifies three receiver overlays on remote cards and one deduplicated sender overlay on the local card. Each participant publishes the harness speech fixture; the assertion is made at the observer's WebRTC boundary. The recorder-oriented Go player is not used because it does not implement Talk's browser `requestoffer` subscription flow.

CI runs this harness against Nextcloud 33 (past), 34 (current), and Nextcloud 35 RC paired with Talk 25 RC (future). The future image is built by `tests/nextcloud-future.Dockerfile`; update its release archive, base image, and the pinned app releases in the workflow when the current major advances.

## Deploy

```sh
npm run deploy
```

This adds or updates the four public assets in the authenticated `pgs.sh:/talk-waveforms/` project without deleting unrelated remote files.
