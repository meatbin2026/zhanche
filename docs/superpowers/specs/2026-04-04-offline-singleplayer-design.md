# Offline Singleplayer Conversion Design

## Context

This project is not the original Cocos Creator workspace. It is a built web export that contains:

- engine bootstrap files such as `index.html`, `main.6211c.js`, and `src/settings.ec5d7.js`
- bundled gameplay and UI logic in `assets/script/index.7825e.js`
- scene bundle metadata in `assets/scene/config.e76d5.json`
- resource bundle metadata in `assets/res/config.45fd8.json` and `assets/resources/config.5ecde.json`

The design therefore optimizes for low-risk modifications inside a built package rather than large structural rewrites.

## Goal

Convert the game into a personal offline singleplayer version while preserving the original feel of the shipped build.

The offline version should:

- keep the existing startup, login, menu, battle, and progression structure
- keep the login page visible instead of skipping directly to the main menu
- replace remote account, network, platform, and ad dependencies with local behavior
- preserve beginner progression instead of pre-unlocking content
- preserve reward-oriented UI pages where practical, but make them function locally

## Non-Goals

This project will not attempt to:

- reconstruct the original Cocos Creator source project
- preserve real multiplayer, leaderboard, or live-service behavior
- preserve real ad playback, real sharing, or real platform integrations
- redesign menus or remove every trace of live-ops UX unless required for stability

## Chosen Approach

Use a minimal-intrusion offline conversion.

This approach keeps the visible structure of the original game intact and replaces external dependencies with local success paths and local persistence. It is preferred because the project is a built export, so broad cleanup or UI refactors would create unnecessary risk.

## Alternatives Considered

### 1. Minimal-Intrusion Offline Conversion

Keep the original page flow and most UI. Replace network, platform, and ad behavior with local stand-ins.

Pros:

- lowest risk in a packed build
- preserves the original feel
- keeps most menus and flows usable

Cons:

- some live-service surfaces will still exist conceptually
- more compatibility glue is needed

### 2. Deep Offline Cleanup

Remove or hide most live-service and platform-facing features.

Pros:

- cleaner pure-singleplayer surface
- less long-term confusion about unsupported features

Cons:

- much more invasive in packed logic
- higher chance of regressions across menus

### 3. Thin Compatibility Shell

Only intercept a few failures and try to let the rest of the game believe services still exist.

Pros:

- fastest to attempt

Cons:

- brittle
- likely to fail on edge flows
- poor long-term maintainability

## Product Decisions Confirmed

- Keep the login page.
- Preserve the overall original menu structure.
- Preserve reward-related pages where practical.
- Convert ad-based or server-backed rewards into local rewards.
- Start from a true beginner save, not a boosted or midgame save.
- Do not unlock base content ahead of progression.

## Functional Scope

### Preserve

- startup flow
- login page
- main menu
- chapter progression
- train mode
- battle loop
- local save continuity
- sign-in style rewards where possible
- daily task style rewards where possible
- mail UI where possible
- ad reward flows as local success actions

### Degrade Gracefully

- live network connections
- remote account identity
- real ads
- real share callbacks
- real platform launch hooks
- remote mail fetching
- multiplayer or ranking features
- hot update behavior

## System Design

### 1. Login and Account Layer

Relevant areas include `LoginMenu` and the local `userDataMgr` mock.

Design:

- keep the login screen and loading progression
- keep the button and transition structure as close to the original as possible
- route login completion to local account initialization instead of remote auth
- use one stable local user identity stored in browser storage

Expected result:

- the player still experiences a login flow
- the flow always succeeds offline
- the resulting save remains tied to local browser storage

### 2. Network Layer

Relevant areas include `net`, `pomelo`, and remote config fetch behavior.

Design:

- stub or short-circuit remote requests to local success responses
- prevent offline failures from blocking menu entry or reward flows
- preserve response shapes expected by callers whenever possible

Expected result:

- UI code that expects a callback still receives one
- the game no longer depends on a reachable backend

### 3. Platform and SDK Layer

Relevant areas include `sdk`, `mpsdk`, and platform-specific entry points.

Design:

- keep non-critical platform calls harmless
- replace ad and platform callbacks with local success paths
- prevent external platform APIs from becoming runtime blockers in browser-only offline play

Expected result:

- the game can run as a standard local web game
- reward buttons that once depended on ads can still grant rewards

### 4. Local Persistence

Relevant areas include `privacy`, `localStorage`, local account data, and systems that currently mix online and local state.

Design:

- continue using browser storage as the source of truth
- treat local persistence as the primary save path, not a fallback cache
- preserve existing save keys where possible to reduce rewriting

Expected result:

- save and reopen should continue the same local profile
- progression remains stable without a server

### 5. Reward and Live-Ops Surfaces

Relevant areas include sign-in, daily task, mail, online boxes, and ad-based reward menus.

Design:

- keep pages visible where they can be made meaningful locally
- convert reward fulfillment to local grant flows
- use local timers and local counters instead of server truth
- where mail cannot be meaningfully fetched, use a static local inbox model or an empty but non-broken mailbox

Expected result:

- these pages remain usable for a personal offline build
- clicking reward actions grants items locally instead of dead-ending

### 6. Core Gameplay and Progression

Relevant areas include `chapter`, `adventure`, `train`, `Game`, `LevelManager`, `Hero`, `Vehicle`, and equipment/talent systems.

Design:

- avoid structural changes to combat and progression systems
- only patch online assumptions that prevent normal play
- preserve beginner progression and unlock pacing

Expected result:

- the player starts from an authentic early-game state
- the main singleplayer loop remains recognizable

## Data Strategy

### Initial Save

The first boot should create a fresh beginner profile. It should not grant extra unlocks or skip progression gates.

### Time-Based Systems

Daily refresh, sign-in cadence, online reward timers, and shop refreshes should use local device time.

Tradeoff:

- this is acceptable for a personal offline build
- device time changes may affect refresh behavior

### Reward Delivery

Reward pages should continue to use their original UX where practical, but delivery should happen locally.

Examples:

- ad reward buttons simulate a successful completion
- sign-in rewards mark progress locally
- task rewards use local counters and local claims

## Compatibility Strategy

Because the project is a built export, changes should prefer:

- wrapping or replacing existing function behavior
- preserving expected callback signatures
- preserving expected data object shapes
- minimizing edits to combat-critical logic

Avoid:

- broad rewrites of bundled gameplay systems
- cosmetic refactors that increase risk without helping offline play

## Risks

### Risk 1: Packed Bundle Coupling

Much of the logic lives in a single packed script file. Small compatibility edits may affect multiple screens.

Mitigation:

- isolate patches around service boundaries
- test full user journeys after each change set

### Risk 2: Hidden Online Assumptions

Some UI flows may assume remote state in ways that are not obvious from the menu surface.

Mitigation:

- provide local default values that match expected response structures
- prefer returning valid local objects over removing code paths

### Risk 3: Time-Based Edge Cases

Local-time-driven systems can behave oddly if device time changes.

Mitigation:

- accept this as a singleplayer tradeoff
- keep logic simple and predictable

### Risk 4: Regression in Reward Pages

Reward surfaces are often wired into many systems.

Mitigation:

- implement them after core login, menu, battle, and save stability are proven

## Implementation Order

### Phase 1: Entry and Stability

- make login succeed offline
- make main menu load reliably
- prevent platform and network blockers at startup

### Phase 2: Core Singleplayer Loop

- verify chapter start
- verify battle start and finish
- verify save persistence across reloads

### Phase 3: Reward and Live-Ops Conversion

- convert ad reward paths
- convert sign-in
- convert daily tasks
- convert mail and timed rewards

### Phase 4: Cleanup and Polish

- remove or soften remaining broken online affordances
- fix UI text or flows that still imply unsupported behavior

## Validation Plan

The implementation is acceptable only if the following path works end to end:

1. Open the game.
2. Reach the login screen without crashes.
3. Complete login offline and enter the main menu.
4. Start early-game progression from a beginner state.
5. Enter battle and complete a run.
6. Refresh or reopen the game and retain local progress.
7. Open sign-in, task, mail, and reward surfaces without runtime failure.
8. Claim locally granted rewards successfully.

## Acceptance Criteria

- the game is playable offline in a browser
- no backend is required for normal singleplayer use
- login page remains present
- beginner progression remains intact
- ad-based and server-backed reward flows no longer hard-fail
- saves persist locally across sessions

## Assumptions

- browser `localStorage` is acceptable as the only persistence layer
- this build is intended for personal use rather than anti-tamper distribution
- preserving playability is more important than perfectly simulating the original live service

## Open Questions Deferred

These are intentionally left for implementation-time discovery rather than pre-design expansion:

- which exact live-op pages need a static local inbox versus simple empty-state support
- whether any hidden PVP or ranking entry points need explicit disabling
- whether one or two reward surfaces should be downgraded instead of fully localized if they prove too coupled
