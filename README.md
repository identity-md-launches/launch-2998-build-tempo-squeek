# Tempo Squeek — Sync or Sleep

A free, 90-second rhythm runner for the Squeekchain community. Jump hurdles, duck under branches, and collect cheese in time with Squeektoshi’s real wheel. All artwork is drawn in code. Playing needs no account, wallet, token or purchase; an optional wallet layer adds a free sign-in, a public leaderboard and an optional Sepolia checkpoint.

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

Live and SIM best scores are stored separately in `localStorage` under `tempo-squeek.best.v1`. Any run that changes data sources counts as SIM practice. If storage is unavailable, the UI says the best is kept only for that visit. These device records stay exactly as before for players without a wallet. The shared, wallet-signed leaderboard is described below; a score is self-reported by the browser that played it, as in any client-side game.

## How the wheel drives the game

- **Live API:** `GET https://api.squeekchain.com/v1/status` immediately, then every **5 seconds**, with a 4-second request deadline. No key or credentials are sent. Non-success HTTP responses, invalid payloads, missing rounds, and explicitly stale/offline measurements count as failures.
- **RPM:** `measurement.rpmMilli / 1000`. The HUD shows the unmodified reading. Effective tempo is clamped to 120 RPM; one revolution produces one beat. RUN scrolling is `100 + 3.1 × effective RPM` world units per second.
- **Phases:** RPM greater than 2 means **RUN**. RPM at or below 2 means **NAP**: the scenery moves at 7 world units per second, obstacle/normal-cheese positions freeze, and Dream Cheese drifts into reach. Physics still works, so jump for high Dream Cheese. No wheel beat is fabricated while it rests.
- **Round and seed:** the parser reads `oracle.latestClosure.lastRound`, falling back to `builder.anchor.settledThroughRound`; if both are present, it selects the greater reported round. Decimal strings are handled with `BigInt`. The seed is exactly `((round * 7919 + 4242) % 90000) + 10000`. For example, round 253 produces seed **37749**.
- **Shared layout:** every track slot depends only on that seed and its slot index, not the frame rate, screen width, player action or random wall-clock value. On a new round, the displayed round/seed and future generation update together. Already-visible obstacles remain stable until they pass, avoiding sudden hazards during a transition.
- **Failure and practice:** three consecutive failed polls switch automatically to **“SIM — simulated wheel, not live”**. The first two failures explicitly label a retained sample as the last reading; without any valid sample the game waits. A success resets the failure count. The LIVE/SIM buttons work at any time; selecting LIVE requests a fresh reading. An unfinished run holds its time while reconnecting. SIM uses a clearly named practice track (seed 48271) and a repeatable 36-second local wheel cycle containing RUN and NAP. It never supplies a fake SqueekCore round.

The public endpoint is the only external runtime request. All visual assets and the font are local; audio is synthesized with Web Audio. The game remains playable in SIM when the API is blocked. No service worker is required or installed.

## On-chain layer (optional)

Everything here is optional. With no wallet the game plays exactly as before, and nothing below runs except a read of the public board.

- **Connect wallet.** The header control opens a sheet listing every browser wallet that announces itself by EIP-6963 (MetaMask, Rabby, Brave, Phantom…) under its own name and icon; with none announced, a legacy injected wallet appears as “Browser wallet”. On a phone browser without a wallet the sheet offers “Open in MetaMask / Coinbase Wallet / Phantom”, which reopen this page in that wallet’s browser. No relay, SDK or project ID is involved.
- **Free sign-in.** After connecting, the player signs **one** message with `personal_sign`. It names the wallet and this browser’s leaderboard key. It is **not a transaction and costs no gas**, and the UI says so. Signing is optional.
- **Public leaderboard.** After sign-in, each finished **live** run (not SIM, not a run that switched sources) is published as a signed score event to open Nostr relays (`src/chain/config.ts`). Every visitor reads the same relays, so every visitor sees the same board: shortened address, best score, the SqueekCore round of that best run, and when it was set. Each visitor’s browser keeps only events whose wallet signature recovers to the claimed address and names the key that signed the event, so nobody can post under another wallet. A run counts only if the wallet was signed in when the run started. The HUD shows the signed-in wallet’s best and rank. `localStorage` still holds the no-wallet personal best.
- **Checkpoint this run on-chain.** After a live run, a signed-in player may call `SqueekMining.checkpoint()` (selector `0xc2c4c5c1`) on **Ethereum Sepolia** at `0x2dccb11fcc2defdd188555e45acb52231e82e218`. This is the public, permissionless SqueekMining checkpoint: it processes settled SqueekCore rounds from `checkpointStatus().nextRound` onward and the caller’s address is recorded on the transaction. The player’s own wallet sends and pays the test-ETH fee; the site holds no keys and pays for nothing. Before asking the wallet, the site reads `SqueekCore.settledThroughRound()` (`0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4`), `SqueekMining.state()` and `checkpointStatus()` and simulates the call, as the Squeekchain developer docs describe. Plain-English messages cover: no wallet, not signed in, wrong network (with a “Switch to Ethereum Sepolia” button that sends `wallet_switchEthereumChain`, then `wallet_addEthereumChain`), the run’s round not settled yet, nothing new to checkpoint, paused contracts, rejection in the wallet, and a reverted transaction. A successful send shows the transaction hash linked to Sepolia Etherscan and then the confirmation block. None of this blocks play.

No tokens, wagering or purchases; Sepolia testnet only. Contract addresses were read from the public Squeekchain API (`/v1/core`, `/v1/economy/state`, release `core-sepolia-20261103`) and checked against Sepolia (`https://ethereum-sepolia-rpc.publicnode.com`).

### Decisions made for this job

- **Where the shared leaderboard lives.** The brief asks for real shared state but supplies no backend, and a static IPFS export cannot hold one. An earlier attempt stopped to ask; nobody answers here, so this build uses **open Nostr relays** as the shared store. They need no account, key or server of ours, every visitor reads the same events, and the wallet signature check keeps entries honest about who signed them. Relays used are listed in `src/chain/config.ts`; a board entry survives as long as any one of them keeps it. If the project later runs its own relay, add its `wss://` URL to that list and rebuild.
- **“Checkpoint for the round the run was played in.”** `checkpoint()` takes no arguments; it always processes the next settled rounds. The button is enabled only once the run’s round has settled on Sepolia and a settled round is waiting, and the message says which rounds the call processes.
- **Wallet libraries.** The project’s `package.json` and lockfile may not change in this job, so wallet discovery, signing, ABI calls, keccak-256, secp256k1 recovery and BIP340 signatures are small dependency-free modules in `src/chain/`, tested against published vectors and Foundry `cast` output. Coinbase Smart Wallet (passkey wallets) needs the Coinbase SDK and is therefore not offered; Coinbase Wallet users can use “Open in Coinbase Wallet” or its extension. Rabby has no documented deep link, so it is reached through its extension.

### After launch

Nothing needs to be set. All addresses are public Sepolia contracts, and no key, project ID or service URL is required.

## Source and checks

The fresh implementation uses **TypeScript, Canvas 2D, native HTML controls and Vite**. There is no runtime framework dependency.

| Path | Responsibility |
| --- | --- |
| `src/wheel.ts` | Validated public feed, precise seed formula, poll/fallback state machine, SIM cycle |
| `src/game.ts` | Deterministic track, elapsed time, movement, collisions and scoring |
| `src/render.ts` | Code-drawn hamster, scenery, wheel, obstacles, cheese and beat ring |
| `src/main.ts`, `src/styles.css` | Responsive interface, inputs, accessible dialog and game lifecycle |
| `src/audio.ts`, `src/storage.ts` | Optional synthesized sound and device-local records |
| `src/onchain.ts` | Wallet sheet, free sign-in, leaderboard section, wallet HUD line and checkpoint panel |
| `src/chain/` | Sepolia/relay configuration, EIP-6963 wallet calls, SqueekMining reads and errors, signed Nostr leaderboard, keccak/SHA-256 and secp256k1 |
| `tests/` | Engine/feed tests and production browser interaction checks |
| `scripts/social-card.svg` | Editable code source for the local PNG share image |
| `dist/` | Production export used by the static publisher |

```sh
npm test
npx playwright install chromium
npm run test:browser
node tests/onchain-browser.mjs   # needs Foundry's `cast` on PATH for the mock wallet's signatures
npm run check:bundle
```

The browser suite owns a temporary static server, serves the **actual export at `/preview/`**, and closes it when finished. Screenshots and raw results go to disposable `test/scratch/`. WebKit is attempted if its browser and native dependencies are installed. To regenerate the share image after editing its SVG, run `node scripts/make-social-card.mjs`, then rebuild.

In the assignment workspace, dependencies were installed only under `test/scratch/tooling/`. The same scripts ran with that directory’s `.bin` prepended to `PATH` and `TEMPO_TEST_TOOLCHAIN=./test/scratch/tooling` for browser scripts. No dependency directory, cache, archive, registry mirror or submodule is part of the export/submission.

Actual check outcomes, coverage, fixes and limitations are recorded in [artifacts/validation.md](artifacts/validation.md). The implemented visual system is documented in [DESIGN.md](DESIGN.md). These are worker-side observations, not independent certification.

Validation on 2026-11-12 (this job): `npm run typecheck` and `npm run build` passed; `npm test` passed **24/24** (18 original engine/feed tests plus 6 for hashes, selectors, signature recovery, BIP340 vectors, revert messages and score-event verification); `npm run test:browser` passed **10/10** original Chromium checks (gameplay with no wallet, live API shape, SIM fallback, 200% text, axe); `node tests/onchain-browser.mjs` passed **6/6** (connect, free sign-in, published run with HUD best and rank, wrong network → switch, not settled, wallet rejection with the game still usable, real `checkpoint()` calldata to SqueekMining with hash and Etherscan link, a second walletless visitor seeing the same board, a forged score ignored, no page errors); the pinned `taste.mjs` probe passed **16/16**. A real relay round trip from this machine stored and re-read a test event (separate test tag) on relay.nostr.net, offchain.pub, relay.snort.social and nostr.oxtr.dev; nos.lol, relay.primal.net and relay.damus.io did not accept or answer from here and remain as extra relays. Limitations: the browser tests use a mock EIP-6963 wallet, an in-memory relay and mocked Sepolia RPC answers; no transaction was sent to Sepolia from this machine (it holds no wallet), so a real MetaMask session and a real checkpoint transaction were not exercised. Details: [artifacts/validation.md](artifacts/validation.md).

## Reference and credits

The requested [playable reference](https://bachtran0110.github.io/tempo-squeek/) and its [source](https://github.com/Bachtran0110/tempo-squeek) were reviewed for gameplay and live API shape. This is a fresh build; the assignment’s 90-second run, frozen obstacles, real-data labels and touch gestures take precedence over reference behavior.

The pinned Better Interface guidance by Jakub Krehel (MIT), the adapted Impeccable documentation method by Paul Bakaus (Apache-2.0), and the pinned design-critic probe informed implementation and review. No guide text or upstream game source is distributed in the runtime. Space Grotesk is bundled under the [SIL Open Font License](public/fonts/OFL.txt).
