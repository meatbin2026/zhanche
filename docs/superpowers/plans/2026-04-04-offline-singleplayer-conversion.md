# Offline Singleplayer Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the exported Cocos web build into a personal offline singleplayer build that keeps the original login/menu/progression structure while replacing remote, ad, and platform dependencies with local behavior.

**Architecture:** Keep the built package structure intact and patch service boundaries instead of rewriting gameplay. Add one small offline runtime helper for reusable local utilities, then patch the packed bundle modules that currently assume remote auth, network callbacks, platform SDKs, and server-backed reward flows. Validate through browser smoke tests that follow the actual player journey.

**Tech Stack:** Static HTML, Cocos Creator 2.4.13 runtime, bundled JavaScript in `assets/script/index.7825e.js`, browser `localStorage`, GitHub Pages/local static serving for QA

---

## Planned File Structure

### Files To Create

- `src/offline-singleplayer.js`
  - Small runtime helper loaded by `index.html`
  - Owns the offline flag, local-time helpers, local reward helpers, no-op SDK shims, and browser-visible debug probes used during implementation

- `docs/superpowers/plans/2026-04-04-offline-singleplayer-conversion.md`
  - This execution plan

### Files To Modify

- `index.html`
  - Load `src/offline-singleplayer.js` before the game bootstrap

- `assets/script/index.7825e.js`
  - Patch packed modules for login, network, SDK, local persistence integration, reward surfaces, and runtime guards

### Files To Use For Reference Only

- `docs/superpowers/specs/2026-04-04-offline-singleplayer-design.md`
- `src/settings.ec5d7.js`
- `main.6211c.js`
- `assets/main/index.4d6e1.js`
- `assets/scene/config.e76d5.json`
- `assets/resources/config.5ecde.json`

## Testing Strategy

This build has no reliable unit test harness and most logic lives inside a packed bundle. Testing will therefore use repeatable smoke checks:

- local static serving with `python3 -m http.server 4173`
- browser load checks against `http://127.0.0.1:4173/`
- console-error inspection
- player-journey validation: login -> main menu -> chapter/battle -> save/reload -> reward pages

When a task says "write the failing test", use a failing browser/runtime probe or a deliberate smoke-check assertion before implementing the fix.

## Task 1: Add Offline Runtime Helper And Loader

**Files:**
- Create: `src/offline-singleplayer.js`
- Modify: `index.html`
- Test: browser smoke check at `http://127.0.0.1:4173/`

- [ ] **Step 1: Add a failing runtime probe to confirm the helper is not loaded yet**

Use this browser console probe before changing files:

```js
console.log("offline helper present:", !!window.__OFFLINE_SINGLEPLAYER__);
```

Expected before implementation: `false`

- [ ] **Step 2: Create the offline helper file**

Create `src/offline-singleplayer.js` with this initial structure:

```js
(function () {
  var storagePrefix = "offline_singleplayer:";

  function now() {
    return Date.now();
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(storagePrefix + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn("offline loadJson failed", key, err);
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(storagePrefix + key, JSON.stringify(value));
    } catch (err) {
      console.warn("offline saveJson failed", key, err);
    }
  }

  window.__OFFLINE_SINGLEPLAYER__ = {
    enabled: true,
    now: now,
    todayKey: todayKey,
    loadJson: loadJson,
    saveJson: saveJson
  };
})();
```

- [ ] **Step 3: Load the helper in `index.html` before `main.6211c.js`**

Add this script tag:

```html
<script src="src/offline-singleplayer.js" charset="utf-8"></script>
```

Place it after `src/settings.ec5d7.js` and before `main.6211c.js`.

- [ ] **Step 4: Run the local server and verify the helper is now present**

Run:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/` and run:

```js
console.log("offline helper present:", !!window.__OFFLINE_SINGLEPLAYER__);
```

Expected: `true`

- [ ] **Step 5: Commit**

```bash
git add index.html src/offline-singleplayer.js
git commit -m "feat: add offline runtime helper"
```

## Task 2: Make Login Complete Offline Without Removing The Login Screen

**Files:**
- Modify: `assets/script/index.7825e.js`
- Test: login flow from `http://127.0.0.1:4173/`

- [ ] **Step 1: Write the failing smoke check**

Run the game and verify the current login flow still depends on remote-style behavior.

Use this check:

```js
console.log("login screen visible:", !!cc && !!cc.director);
```

Then attempt the login button flow.

Expected before implementation: login relies on network-style flow or remote-shaped callbacks and is not guaranteed offline-safe.

- [ ] **Step 2: Locate and patch `LoginMenu`**

Find the `LoginMenu` module in `assets/script/index.7825e.js` and patch these methods:

- `callLogin`
- `login`
- `downloadData`
- any direct dependency that blocks `runMainMenu`

Implementation target:

```js
// Keep the login page and loading behavior, but route completion locally.
if (window.__OFFLINE_SINGLEPLAYER__ && window.__OFFLINE_SINGLEPLAYER__.enabled) {
  this.nativePlatform = t || CH;
  this.loadingUI.active = true;
  this.loginUI.active = false;
  this.waitProgress(4, 0.4, 0.6);
  this.downloadExcel();
  return;
}
```

And inside the local data path:

```js
var localUser = {
  openId: cc.sys.localStorage.getItem("offline_open_id") || "offline-user",
  uid: cc.sys.localStorage.getItem("offline_uid") || "offline-user"
};
this.downloadData(localUser);
```

- [ ] **Step 3: Make `downloadData` always hydrate from local user storage when offline**

Inside `downloadData`, use the existing `userDataMgr` path when offline and do not wait on remote data:

```js
if (window.__OFFLINE_SINGLEPLAYER__ && window.__OFFLINE_SINGLEPLAYER__.enabled) {
  var store = a.getInstance().getUserData(e.openId);
  var doc = store.doc;
  var initConfig = store.initConfig || {};
  user.setOnlineData(doc);
  // keep the existing downstream setOnlineData calls
}
```

- [ ] **Step 4: Verify the login flow reaches the main menu offline**

Run:

```bash
python3 -m http.server 4173
```

Manual verification:

- load `http://127.0.0.1:4173/`
- observe startup and login page
- complete login
- confirm main menu opens without network requests being required

Expected: startup -> login -> main menu works fully offline

- [ ] **Step 5: Commit**

```bash
git add assets/script/index.7825e.js
git commit -m "feat: make login flow work offline"
```

## Task 3: Replace Network Dependencies With Offline Success Paths

**Files:**
- Modify: `src/offline-singleplayer.js`
- Modify: `assets/script/index.7825e.js`
- Test: main menu entry and reward/menu pages

- [ ] **Step 1: Write the failing smoke check for blocked requests**

Open the game and trigger pages that depend on backend-style callbacks.

Expected before implementation: some flows attempt `net.post`, `net.postSilent`, `net.updateData`, `net.updateLazyData`, or websocket setup.

- [ ] **Step 2: Extend the helper with canonical offline response builders**

Add these utilities to `src/offline-singleplayer.js`:

```js
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ok(payload) {
  return { ok: true, payload: payload || {} };
}

window.__OFFLINE_SINGLEPLAYER__.net = {
  clone: clone,
  ok: ok
};
```

- [ ] **Step 3: Patch the `net` module to short-circuit remote calls when offline**

In `assets/script/index.7825e.js`, patch the `net` module methods used by gameplay/menu code:

- `init`
- `gate`
- `connect`
- `post`
- `postSilent`
- `updateData`
- `updateLazyData`

Implementation target:

```js
if (window.__OFFLINE_SINGLEPLAYER__ && window.__OFFLINE_SINGLEPLAYER__.enabled) {
  var callback = cb || function () {};
  setTimeout(function () {
    callback(null, {});
  }, 0);
  return;
}
```

For mutation-style APIs, make sure the local user data store is updated before callback execution.

- [ ] **Step 4: Patch websocket/pomelo setup to become harmless offline**

Guard connection setup so that offline mode never blocks waiting for sockets:

```js
if (window.__OFFLINE_SINGLEPLAYER__ && window.__OFFLINE_SINGLEPLAYER__.enabled) {
  this.status = 3;
  return;
}
```

- [ ] **Step 5: Verify the main menu and service-backed pages no longer hard-fail**

Manual verification:

- enter the main menu
- open at least one of sign-in, mail, task, and shop
- confirm no blocking error appears and the game remains responsive

- [ ] **Step 6: Commit**

```bash
git add src/offline-singleplayer.js assets/script/index.7825e.js
git commit -m "feat: stub network layer for offline play"
```

## Task 4: Replace Platform And Ad SDK Dependencies

**Files:**
- Modify: `src/offline-singleplayer.js`
- Modify: `assets/script/index.7825e.js`
- Test: reward buttons and startup/platform guards

- [ ] **Step 1: Write the failing smoke check**

Trigger an ad-style reward entry and note current behavior.

Expected before implementation: ad callbacks depend on platform SDK availability or external services.

- [ ] **Step 2: Extend the helper with ad-success and platform-noop utilities**

Add this to `src/offline-singleplayer.js`:

```js
window.__OFFLINE_SINGLEPLAYER__.sdk = {
  simulateSuccess: function (cb, payload) {
    setTimeout(function () {
      if (cb) cb(payload || {});
    }, 0);
  },
  now: function () {
    return Date.now();
  }
};
```

- [ ] **Step 3: Patch the `sdk` module so ad and platform calls resolve locally**

Patch common SDK methods to use local success behavior in offline mode:

- rewarded-video style flows
- interstitial/custom ad creators
- share completion callbacks
- config getters that should remain stable

Implementation target:

```js
if (window.__OFFLINE_SINGLEPLAYER__ && window.__OFFLINE_SINGLEPLAYER__.enabled) {
  return {
    load: function () {},
    show: function () {
      if (this.onCloseCb) this.onCloseCb({ isEnded: true });
    },
    onClose: function (cb) { this.onCloseCb = cb; },
    onError: function () {},
    onLoad: function () {}
  };
}
```

- [ ] **Step 4: Guard `mpsdk` and other platform startup calls**

Patch startup code so `window.mpsdk` being absent never affects startup completion.

Expected code pattern:

```js
var sdkObj = window.mpsdk;
if (!sdkObj || (window.__OFFLINE_SINGLEPLAYER__ && window.__OFFLINE_SINGLEPLAYER__.enabled)) {
  return;
}
```

- [ ] **Step 5: Verify ad-reward buttons can resolve locally**

Manual verification:

- click at least one reward flow that previously required ad completion
- confirm the reward path completes without a real ad

- [ ] **Step 6: Commit**

```bash
git add src/offline-singleplayer.js assets/script/index.7825e.js
git commit -m "feat: make sdk and ad flows work offline"
```

## Task 5: Make Local Persistence The Primary Source Of Truth

**Files:**
- Modify: `src/offline-singleplayer.js`
- Modify: `assets/script/index.7825e.js`
- Test: reload persistence

- [ ] **Step 1: Write the failing persistence check**

Before implementing, note one piece of progress, reload the page, and confirm where persistence breaks or still depends on online-style sync.

- [ ] **Step 2: Add an offline save bootstrap record**

Extend `src/offline-singleplayer.js` with:

```js
window.__OFFLINE_SINGLEPLAYER__.profile = {
  ensure: function () {
    var profile = loadJson("profile", null);
    if (!profile) {
      profile = {
        createdAt: now(),
        beginner: true
      };
      saveJson("profile", profile);
    }
    return profile;
  }
};
```

- [ ] **Step 3: Patch local account and save mutation flows to update browser storage immediately**

Focus on these areas in `assets/script/index.7825e.js`:

- `userDataMgr`
- `privacy`
- systems that currently expect online mutation success before persisting state

Implementation target:

```js
if (window.__OFFLINE_SINGLEPLAYER__ && window.__OFFLINE_SINGLEPLAYER__.enabled) {
  // apply mutation to local doc immediately, then callback
  return updatedDoc;
}
```

- [ ] **Step 4: Verify save continuity**

Manual verification:

- start from login
- make one visible progression change
- refresh the page
- confirm the same local state is restored

Expected: persistence survives reload without backend access

- [ ] **Step 5: Commit**

```bash
git add src/offline-singleplayer.js assets/script/index.7825e.js
git commit -m "feat: promote local storage to primary save path"
```

## Task 6: Keep Beginner Progression While Making Reward Surfaces Local

**Files:**
- Modify: `assets/script/index.7825e.js`
- Test: sign-in, daily task, mail, online reward pages

- [ ] **Step 1: Write the failing smoke checklist**

Attempt these flows and note current failures:

- sign-in
- daily task
- mail
- online box or timed reward

Expected before implementation: one or more flows still depend on remote fetches, ad callbacks, or missing online counters.

- [ ] **Step 2: Patch sign-in and daily-task data sources to use local counters and local dates**

Patch the modules that back:

- `SignMenu`
- `DailyTaskMenu`
- related `task` and user-status helpers

Implementation targets:

```js
var today = window.__OFFLINE_SINGLEPLAYER__.todayKey();
// compare against locally stored last-claim day
```

and

```js
// increment local counters from gameplay events without waiting for remote sync
task.setDailyTaskStatus(...);
```

- [ ] **Step 3: Patch mail flow to use a static local inbox or safe empty-state**

Patch `MailMenu` and its backing mail fetch path so it never blocks on remote `getMail`.

Implementation target:

```js
var localMail = [
  {
    id: "offline-welcome",
    status: 1
  }
];
```

If a static inbox proves too invasive, return an empty inbox while keeping the screen stable.

- [ ] **Step 4: Patch timed reward/shop refresh paths to use local clock only**

Patch modules backing:

- `shop`
- online timers
- timed reward refresh helpers

Implementation target:

```js
var now = window.__OFFLINE_SINGLEPLAYER__.sdk.now();
```

and never require a server timestamp.

- [ ] **Step 5: Verify reward surfaces remain usable without unlocking extra gameplay**

Manual verification:

- sign-in page can be opened and claimed locally
- daily task page shows stable local progress
- mail page opens without fetch failure
- no extra base unlocks are granted at first boot

- [ ] **Step 6: Commit**

```bash
git add assets/script/index.7825e.js
git commit -m "feat: localize reward and timer surfaces"
```

## Task 7: Verify Core Singleplayer Journey End To End

**Files:**
- Modify: `assets/script/index.7825e.js` as needed for final fixes
- Test: full browser smoke run

- [ ] **Step 1: Run the full smoke journey**

Run:

```bash
python3 -m http.server 4173
```

Then verify:

1. startup loads
2. login page appears
3. login enters main menu
4. first chapter or early-game flow starts
5. battle launches
6. battle can finish and return
7. reward surfaces open
8. refresh keeps progress

- [ ] **Step 2: Fix any remaining blockers discovered in the full journey**

Only patch issues that block offline singleplayer usability. Do not expand scope into cosmetic cleanup unless a cosmetic issue hides a blocker.

- [ ] **Step 3: Re-run the full smoke journey**

Expected: complete pass with no blocking errors

- [ ] **Step 4: Capture a concise verification note in the plan or commit message context**

Record:

- what journey was tested
- which pages were confirmed stable
- any intentional degradations that remain

- [ ] **Step 5: Commit**

```bash
git add assets/script/index.7825e.js
git commit -m "fix: finalize offline singleplayer stability"
```

## Task 8: Update Docs For The Local Singleplayer Build

**Files:**
- Modify: `README.md` if created later, otherwise create `docs/offline-singleplayer-notes.md`
- Test: documentation read-through

- [ ] **Step 1: Add a short operator note describing how to run the offline build**

Include:

- how to serve locally
- where saves live
- which online features are intentionally simulated

Suggested content:

```md
# Offline Singleplayer Notes

- Serve with `python3 -m http.server 4173`
- Open `http://127.0.0.1:4173/`
- Saves are stored in browser localStorage
- Ad and network-backed rewards are simulated locally
```

- [ ] **Step 2: Verify the doc matches actual behavior**

Read through after the final smoke pass and correct any mismatch.

- [ ] **Step 3: Commit**

```bash
git add docs/offline-singleplayer-notes.md
git commit -m "docs: add offline singleplayer run notes"
```

## Execution Notes

- Prefer small, reversible patches over one large rewrite.
- After every task, reload the game and verify the previous path still works.
- Do not unlock content beyond the original beginner state.
- If a reward page proves too coupled to localize safely, preserve the page shell and return a stable no-crash empty state instead of forcing a broken full implementation.

## Review Checklist

Before considering the implementation done, confirm:

- login page is preserved
- no backend is needed for normal play
- no real ad is needed for reward flows
- beginner progression is still intact
- progress persists across page reloads
- reward pages do not hard-fail
