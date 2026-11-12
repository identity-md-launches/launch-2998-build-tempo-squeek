# Tempo Squeek design system

## Overview

Tempo Squeek is a small browser game for the Squeekchain community. Its visual idea is a warm, moonlit hamster habitat with a great wheel on the horizon and a beat ring around the runner. The playable scene is the page’s focus. A compact product name and utilities sit above it; the start action appears inside the scene, with jump and duck controls directly below.

The dark, amber and cream direction is intentional. There is one page, one primary action per game state, and no marketing section between arriving and playing. All gameplay art is drawn with Canvas 2D in `src/render.ts`; interface icons are local SVG paths in `src/icons.ts`. `scripts/social-card.svg` produces the locally bundled PNG share image.

## Colors

`src/styles.css:8` defines the canonical hex palette and semantic aliases. UI components use the semantic names. The canvas has a related, deliberately quieter illustrative palette in `src/render.ts`.

| Semantic token | Primitive / value | Use |
| --- | --- | --- |
| `--color-page` | `--ink-950`, `#12130f` | Page background; dark text on amber |
| `--color-surface` | `--ink-900`, `#191b15` | Game cabinet, dialogs, key hints |
| `--color-raised` | `--ink-850`, `#20221b` | Jump and duck buttons |
| `--color-hover` | `--ink-800`, `#2a2c23` | Hover/pressed surfaces, selected source, phase background |
| `--color-border` | `--ink-700`, `#3c4033` | Structural boundaries and separators |
| `--color-text` | `--cream-100`, `#f4efde` | Main text and keyboard focus |
| `--color-muted` | `--cream-400`, `#b1b49f` | Descriptions and secondary labels |
| `--color-accent` | `--amber-400`, `#efbe4b` | Primary action, brand detail, cheese and beat feedback |
| `--color-accent-hover` | `--amber-300`, `#f6ce69` | Primary hover, score and reward emphasis |
| `--color-on-accent` | `--ink-950`, `#12130f` | Primary button text |
| `--color-focus` | `--cream-100`, `#f4efde` | 2px focus outline with a 4px surface gap |
| `--color-nap` | `--lavender-300`, `#c8b9ef` | NAP label and Dream Cheese family |
| `--color-live` | `--sage-300`, `#bfd39c` | Live signal and RUN phase |

Status always includes words; the dot and hue are supporting cues. The exact requested SIM disclosure stays visible in the wheel bar throughout practice. There is only a dark theme.

Computed WCAG contrast for the opaque token pairs: cream/surface **15.09:1**, muted/surface **8.19:1**, dark text/amber button **10.78:1**, RUN text/phase surface **8.77:1**, NAP text/phase surface **7.85:1**. These are calculations from the specified pairs, not a claim that every animated canvas pixel was measured. The focus ring is offset onto the dark surrounding surface. See the validation report for rendered coverage and exclusions.

## Typography

One local variable face, **Space Grotesk**, falls back to `system-ui, sans-serif`. Its Latin WOFF2 and OFL license live in `public/fonts/`. It supplies the actual used weights **400, 600 and 700**; no external font request is needed. The face is preloaded by `index.html` and uses `font-display: swap`.

| Token | Default size | Role |
| --- | ---: | --- |
| `--text-caption` | 12px / 0.75rem | Status, data labels, track identity, hints, footer |
| `--text-small` | 14px / 0.875rem | Secondary UI, mobile scene description, compact instructions |
| `--text-body` | 16px / 1rem | Main actions, desktop scene description, help subheadings |
| `--text-heading` | 24px / 1.5rem | Brand, scores, dialog heading, desktop rewards |
| `--text-title` | 40px / 2.5rem | Mobile play prompt; pause/result headings |
| `--text-display` | 64px / 4rem | Desktop play prompt |

The header’s product identity uses a compact H1; the active scene prompt has the visual emphasis. Display tracking is `-0.06em`, brand/dialog tracking is `-0.035em`, and prose uses natural spacing. Body line height is 1.5; instructions use 1.6; the short play prompt uses 1.05. Headings balance, descriptions wrap naturally, and numeric HUD values use tabular figures. A score of at least 10,000 uses the existing body-size token so the full value fits the mobile HUD. There is no monospace prose or text truncation.

## Layout

The layout constants in `src/styles.css` use a 4px base with 8, 12, 16, 24 and 32px spacing steps; the illustration composition also uses small explicit offsets. `.shell` has a 1216px maximum outer width and 32px desktop inline padding. The wheel bar, stats, scene and track identity form one cabinet. Separate flat buttons below it are the touch controls.

The implemented content breakpoints are:

- **46rem / 736px:** 16px page margins; 16px padding in the run panel and leaderboard; the wallet dialog becomes a bottom sheet (full width, top corners only); icon-only help; four compact stats; separate visible pause/restart row during play; scene minimum height 336px instead of 414px; controls keep large targets and place key hints on a second line.
- **28rem / 448px:** compact live-reading typography, 44px mode buttons and a 36px brand mark. The header wraps: sound and help sit on a second row with the wallet control pushed to its right edge; leaderboard cells tighten to 6px padding.
- **22rem / 352px:** 12px page margins, 16px brand and stat values, freely wrapping status/track data, and the decorative signal/trophy marks removed where space is limited.

The score grid uses `auto-fit` with a `3.5rem` minimum on mobile: it becomes two columns when text is enlarged to 200%. The start/result overlay participates in document flow and reserves `6.25rem` beneath its content; it grows with text rather than covering the track bar or controls. Track identity can wrap long round values. The canvas is an absolutely positioned illustration behind that intrinsic scene layout.

Rendered at 320, 390, 768 and 1440 CSS pixels, the page had no horizontal overflow and the start action was in the first viewport. The 390px view was also checked with 200% text enlargement. This was text enlargement, not a native browser zoom session. All content remains in ordinary vertical document flow; no fixed controls cover it.

## Elevation & Depth

The interface is flat: structural borders, tonal backgrounds, and spacing do the grouping. There are no card shadows or gradient text. The cabinet has a single border; the HUD is not a collection of nested cards. The native help dialog has a dark backdrop (`#060805cc`). Pause and result states use a translucent dark scene overlay (`#191b15eb`). The canvas uses silhouettes, quiet wheel outlines and a foreground track to establish depth without adding UI chrome.

## Shapes

`--radius-cabinet` is 20px and `--radius-control` is 10px. Mode-switch children use 7px corners inside a 3px inset. Phase labels use 5px corners, keyboard hints 4px, and the beat/signal markers are circles. The hamster, obstacles and cheese use their own illustrative geometry, never emoji or external sprites.

## Components

| Pattern | Source | Behavior |
| --- | --- | --- |
| `.wheel-bar` / `.mode-switch` | `index.html`, `src/main.ts:73`, `src/styles.css:89` | Connecting, current LIVE, labelled last reading, and explicit SIM states; native buttons with `aria-pressed`; raw RPM and phase stay separate from the effective tempo. |
| `.scoreboard` | `src/main.ts:91`, `src/styles.css:105` | Score, cheese, combo and time; text and values stay stable with tabular digits; no per-frame screen-reader announcements. |
| `.scene` / `.game-overlay` | `src/main.ts:125`, `src/styles.css:111` | Ready, reconnecting, running, paused and finished; one amber Start/Resume/Play again action. Results include distance, cheese, Perfects and combo. |
| `.control-button` | `src/main.ts:222`, `src/styles.css:137` | At least 64px high, pointer/keyboard/touch activation, pressed-state border, disabled until play. Pointer cancellation releases held input. |
| `.icon-button` | `src/icons.ts`, `src/styles.css:84` | At least 44px target, descriptive accessible name, consistent `currentColor` SVG strokes, visible focus and hover states. |
| Native help dialog | `index.html`, `src/main.ts:287` | Pauses play, starts focus at Close, explicitly wraps Tab/Shift+Tab, closes with Escape/backdrop/close action, returns focus to the help trigger. |
| `.wallet-button` | `index.html`, `src/onchain.ts:renderButton`, `src/styles.css` (On-chain layer block) | 44px bordered raised control in the header: wallet glyph in amber plus “Connect wallet”; connected it shows the short checksummed address and the glyph turns sage once signed in. Opens the wallet dialog. |
| Wallet dialog `.wallet-dialog` | `index.html`, `src/onchain.ts:renderDialog` | Native `<dialog>`, at most 420px wide with 16px padding; 48px `.wallet-row`s with a 28px `.wallet-mark` (wallet’s own EIP-6963 icon, or its initial); phone “Open in” rows; signed-in, free sign-in and “Switch to Ethereum Sepolia” blocks separated by hairlines; a text “Disconnect”; one polite `#wallet-note` line for errors. Closes by ×, Escape or backdrop and returns focus to the wallet control. Rows dim to 60% while a wallet prompt is open. |
| `.wallet-hud` | `index.html`, `src/onchain.ts:renderHud` | One line under the track bar inside the cabinet, shown only after sign-in: short address, wallet best and rank. |
| `.run-panel` | `index.html`, `src/onchain.ts:renderRunPanel` | Appears below the controls after a finished run: leaderboard save status, then the optional checkpoint block with an outlined amber `.secondary-button` (48px), a “Switch to Ethereum Sepolia” button when needed, and a polite status line that carries the transaction link. |
| `.leaderboard` | `index.html`, `src/onchain.ts:renderBoard` | Bordered surface panel below the game: 24px heading, Refresh `.text-button`, one status line, and a five-column table (Rank, Wallet, Best, Round, Set) with tabular digits, amber best scores, the viewer’s own row on `--color-raised`, inside a horizontal scroll container for enlarged text. |
| Status announcements | `src/main.ts:61` | Stable polite regions for feed state and significant game events. Beat flashes and fast score changes are not announced repeatedly. |

Hover changes are gated to hover-capable devices. Named background/border/transform transitions last 120ms, only with `prefers-reduced-motion: no-preference`. A press scales a control to 0.96. Reduced motion also removes background parallax, wheel rotation, limb bobbing and the expanding ring; the essential runner motion and static beat cue remain, with a visible pause action. Nothing starts running automatically on arrival. Sound is opt-in.

## Do’s and Don’ts

- Reuse the semantic color and type tokens, `.shell`, native buttons, and the existing focus treatment. Keep new controls near the thing they change.
- Keep the scene and primary action on the first phone screen. Put extra explanation in the existing help dialog.
- Label simulated and retained readings explicitly. A practice seed must never be presented as a SqueekCore round.
- Preserve the generous controls and intrinsic overlay height. Do not hide overflow or shrink important values to conceal layout errors.
- Keep the game’s essential movement distinct from decoration; respect reduced motion for the latter.
- Describe the sign-in as free and gasless every time it is offered, and keep the checkpoint optional and secondary (outlined, never the amber filled action).
- If another small page is later required, start with `.shell`, the brand/utility header and these type/color tokens. Do not add a second font, card system or external artwork merely to decorate it.

Review coverage, observed fixes and unperformed device/screen-reader checks are recorded in [artifacts/validation.md](artifacts/validation.md).
