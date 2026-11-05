# Tempo Squeek — Sync or Sleep

A free, 90-second rhythm runner for the Squeekchain community. Jump hurdles, duck under branches, and collect cheese in time with Squeektoshi’s real wheel. All artwork is drawn in code. The site needs no account, wallet, key, token, contract, purchase or backend.

Tempo Squeek is a community project for the Squeekchain Buildooooor badge.

Canonical IMD job URL:

## Install, run and rebuild

Use Node.js **22.18 or newer** and npm. The package versions are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. To typecheck, build and preview the production export:

```sh
npm run typecheck
npm run build
npm run preview
```

`dist/` is the complete, ready-to-host static site and is included alongside the source. Serve its contents on any static host or at an IPFS gateway subpath. Vite uses `base: './'`; scripts, styles, the font, favicon and share image resolve relatively. There are no client-side routes or server rewrites. Use an HTTP server for local preview rather than opening the HTML as a `file:` URL. Publishing and repository upload are handled by the assignment’s delivery system, not by a deployment script in this project.

## Play

| Action | Desktop | Touch |
| --- | --- | --- |
| Jump | Space, click the track, or Jump | Tap the track or Jump |
| Duck | Hold ↓ or select Duck | Swipe down on the track or tap Duck |
| Pause / resume | P, Escape, or the pause control | Pause control |
| Restart | Restart control | Restart control |

Each run lasts **90 active seconds**. Leaving the tab pauses it; a long rendering stall also pauses it so unseen obstacles do not cost you a combo. Sound is optional and starts off. The instructions dialog pauses a run and leaves it paused when closed.

Score is the sum of distance points and cheese points. Every ten world units travelled add one distance point, multiplied by the combo at that moment. Normal cheese gives `10 × combo`. Collecting it during the **120 ms flash after a wheel beat** gives a **Perfect Squeek**, increments combo by one, and awards `50 × the new combo`. Dream Cheese gives `30 × combo` without inventing beats for a resting wheel. A collision resets combo to ×1; it does not end the run early.

Live and SIM best scores are stored separately in `localStorage` under `tempo-squeek.best.v1`. Any run that changes data sources counts as SIM practice. If storage is unavailable, the UI says the best is kept only for that visit. There is no shared leaderboard or claim that a browser score is verified.

## How the wheel drives the game

- **Live API:** `GET https://api.squeekchain.com/v1/status` immediately, then every **5 seconds**, with a 4-second request deadline. No key or credentials are sent. Non-success HTTP responses, invalid payloads, missing rounds, and explicitly stale/offline measurements count as failures.
- **RPM:** `measurement.rpmMilli / 1000`. The HUD shows the unmodified reading. Effective tempo is clamped to 120 RPM; one revolution produces one beat. RUN scrolling is `100 + 3.1 × effective RPM` world units per second.
- **Phases:** RPM greater than 2 means **RUN**. RPM at or below 2 means **NAP**: the scenery moves at 7 world units per second, obstacle/normal-cheese positions freeze, and Dream Cheese drifts into reach. Physics still works, so jump for high Dream Cheese. No wheel beat is fabricated while it rests.
- **Round and seed:** the parser reads `oracle.latestClosure.lastRound`, falling back to `builder.anchor.settledThroughRound`; if both are present, it selects the greater reported round. Decimal strings are handled with `BigInt`. The seed is exactly `((round * 7919 + 4242) % 90000) + 10000`. For example, round 253 produces seed **37749**.
- **Shared layout:** every track slot depends only on that seed and its slot index, not the frame rate, screen width, player action or random wall-clock value. On a new round, the displayed round/seed and future generation update together. Already-visible obstacles remain stable until they pass, avoiding sudden hazards during a transition.
- **Failure and practice:** three consecutive failed polls switch automatically to **“SIM — simulated wheel, not live”**. The first two failures explicitly label a retained sample as the last reading; without any valid sample the game waits. A success resets the failure count. The LIVE/SIM buttons work at any time; selecting LIVE requests a fresh reading. An unfinished run holds its time while reconnecting. SIM uses a clearly named practice track (seed 48271) and a repeatable 36-second local wheel cycle containing RUN and NAP. It never supplies a fake SqueekCore round.

The public endpoint is the only external runtime request. All visual assets and the font are local; audio is synthesized with Web Audio. The game remains playable in SIM when the API is blocked. No service worker is required or installed.

## Source and checks

The fresh implementation uses **TypeScript, Canvas 2D, native HTML controls and Vite**. There is no runtime framework dependency.

| Path | Responsibility |
| --- | --- |
| `src/wheel.ts` | Validated public feed, precise seed formula, poll/fallback state machine, SIM cycle |
| `src/game.ts` | Deterministic track, elapsed time, movement, collisions and scoring |
| `src/render.ts` | Code-drawn hamster, scenery, wheel, obstacles, cheese and beat ring |
| `src/main.ts`, `src/styles.css` | Responsive interface, inputs, accessible dialog and game lifecycle |
| `src/audio.ts`, `src/storage.ts` | Optional synthesized sound and device-local records |
| `tests/` | Engine/feed tests and production browser interaction checks |
| `scripts/social-card.svg` | Editable code source for the local PNG share image |
| `dist/` | Production export used by the static publisher |

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run check:bundle
```

The browser suite owns a temporary static server, serves the **actual export at `/preview/`**, and closes it when finished. Screenshots and raw results go to disposable `test/scratch/`. WebKit is attempted if its browser and native dependencies are installed. To regenerate the share image after editing its SVG, run `node scripts/make-social-card.mjs`, then rebuild.

In the assignment workspace, dependencies were installed only under `test/scratch/tooling/`. The same scripts ran with that directory’s `.bin` prepended to `PATH` and `TEMPO_TEST_TOOLCHAIN=./test/scratch/tooling` for browser scripts. No dependency directory, cache, archive, registry mirror or submodule is part of the export/submission. The explicit ignore-file and submission budgets are in [artifacts/path-budget.md](artifacts/path-budget.md).

Actual check outcomes, coverage, fixes and limitations are recorded in [artifacts/validation.md](artifacts/validation.md). The implemented visual system is documented in [DESIGN.md](DESIGN.md). These are worker-side observations, not independent certification.

Validation on 2026-11-05: `npm run build` and `npm run typecheck` passed; `npm test` passed **18/18**; `npm run test:browser` passed **10/10** Chromium checks; the pinned `taste.mjs --out test/scratch/taste` probe passed **16/16**. The export is **172,358 bytes** and the bundle audit confirms relative assets and a submission below 8 MiB. Browser tests cover 320/390/768/1440px, desktop and touch controls, live-shaped RUN/NAP transitions, the exact seed, three-failure SIM fallback, complete 90-second runs, replay, persistence, storage denial, focus and 200% text enlargement.

Direct Chromium requests to the public API returned `net::ERR_EMPTY_RESPONSE` in this environment. The HTTP client obtained an actual **200** response with CORS `*`; that response was then supplied unchanged to the production browser test. Controlled API responses test RPM/phase transitions separately. A direct live-browser run against the external service is therefore **not claimed**. WebKit was attempted but could not launch because native system libraries were missing; physical devices, assistive technology sessions and native browser zoom were not tested.

## Reference and credits

The requested [playable reference](https://bachtran0110.github.io/tempo-squeek/) and its [source](https://github.com/Bachtran0110/tempo-squeek) were reviewed for gameplay and live API shape. This is a fresh build; the assignment’s 90-second run, frozen obstacles, real-data labels and touch gestures take precedence over reference behavior.

The pinned Better Interface guidance by Jakub Krehel (MIT), the adapted Impeccable documentation method by Paul Bakaus (Apache-2.0), and the pinned design-critic probe informed implementation and review. No guide text or upstream game source is distributed in the runtime. Space Grotesk is bundled under the [SIL Open Font License](public/fonts/OFL.txt).
