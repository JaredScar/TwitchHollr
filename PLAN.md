# PLAN.md — "Jim": Voice-Controlled Twitch Polls (Electron)

## 1. Goal

A desktop app that runs on the streamer's PC. It listens to their mic, catches commands that start with a wake word ("Jim, poll win or loss"), and starts Twitch polls (and later predictions) through the Helix API. Speech recognition runs **on the PC itself**: no cloud speech service, no per-minute cost, and no sending the streamer's audio to anyone.

**Success criteria**
- From the end of a spoken command to the poll appearing on Twitch: **≤ 2 s** on a mid-range CPU.
- No false triggers from game or desktop audio (the app listens only to the chosen mic).
- A streamer can sign in with Twitch, pick a mic, and run a poll in under 2 minutes, with no developer setup.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron (latest stable) + electron-vite | Desktop app, tray icon, global hotkeys, safeStorage |
| Language | TypeScript everywhere (strict) | |
| UI | Angular (standalone components, signals) | Matches the existing Electron + Angular setup (DockWarden) |
| STT (default) | `sherpa-onnx-node`, streaming Zipformer English model | Offline, streaming, fast on CPU, has keyword spotting |
| STT (optional) | `whisper.cpp` via a Node binding, with GPU (CUDA) | More accurate on machines with a strong GPU |
| Twitch | `@twurple/auth`, `@twurple/api`, `@twurple/eventsub-ws` | Typed Helix client, token refresh, EventSub over WebSocket |
| Storage | `electron-store` (settings), Electron `safeStorage` (tokens) | Tokens encrypted with the OS keychain |
| Packaging | electron-builder (Windows NSIS first, then macOS dmg) | |
| Tests | Vitest (unit), Playwright for Electron (e2e smoke) | |

## 3. Architecture

```
┌──────────── Renderer (Angular) ────────────┐
│ Mic capture: getUserMedia(deviceId)         │
│  → AudioWorklet → resample to 16 kHz mono   │
│  → Int16 frames (~100 ms) via MessagePort ──┼──┐
│ UI: status, live transcript, log, settings  │  │
└─────────────────────────────────────────────┘  │
                     ▲ IPC (typed, contextBridge) │
┌──────────── Main process ──────────────────┐   │
│ AuthService (Device Code Flow, refresh)     │   │
│ TwitchService (polls, predictions, EventSub)│   │
│ CommandRouter (wake word, parse, cooldown)  │   │
│ Tray, global hotkeys, settings              │   │
└───────────────▲─────────────────────────────┘   │
                │ final/partial transcripts        │
┌──────────── utilityProcess: SttWorker ─────┐   │
│ ISttEngine (sherpa-onnx | whisper.cpp)      │◄──┘
│ Endpointing (VAD/silence) → final text      │
└─────────────────────────────────────────────┘
```

- STT runs in an Electron `utilityProcess` so the native addon can't freeze the main process or the UI.
- Audio frames go renderer → worker over a `MessagePort` and never pass through main.
- All IPC channels are typed in `src/shared/ipc.ts`. Turn on `contextIsolation`, turn off `nodeIntegration`, and enable the sandbox.

## 4. Repo layout

```
jim/
  electron.vite.config.ts
  src/
    main/
      index.ts               # app lifecycle, windows, tray
      auth/auth.service.ts
      twitch/twitch.service.ts
      twitch/eventsub.service.ts
      commands/router.ts     # wake word + grammar + cooldown
      commands/grammar.ts    # pure parsing functions (unit-tested)
      stt/worker.ts          # utilityProcess entry
      stt/engines/sherpa.ts
      stt/engines/whisper.ts
      stt/engine.ts          # ISttEngine interface
      store/settings.ts
      store/secrets.ts       # safeStorage wrapper
    preload/index.ts         # contextBridge API
    shared/ipc.ts            # channel names + payload types
    shared/types.ts
    renderer/                # Angular app
      app/
        audio/mic-capture.service.ts
        audio/pcm16-worklet.ts
        pages/dashboard/
        pages/settings/
        pages/onboarding/
  models/                    # downloaded at first run, not committed
  tests/
```

## 5. Core modules

### 5.1 Auth: Twitch Device Code Grant Flow
- Register a Twitch app as a **Public** client (no client secret is shipped).
- Flow: `POST /oauth2/device` → show `user_code` plus a "Open twitch.tv/activate" button → poll `/oauth2/token` until the user authorizes.
- Scopes: `channel:manage:polls`, `channel:manage:predictions` (Phase 3), `channel:read:polls` (covered by manage), `user:read:chat` (optional).
- Encrypt the access and refresh tokens with `safeStorage`. Public-client refresh tokens can be used only once, so **always save the new refresh token** after every refresh.
- Run `GET /oauth2/validate` at startup and then every hour (Twitch requires this). On a 401, refresh; if the refresh fails, show a sign-in banner.
- Get `broadcaster_id` from `GET /helix/users` with the token. Check `broadcaster_type` is `affiliate` or `partner`; if not, block polls and explain why.

### 5.2 Mic capture (renderer)
- `navigator.mediaDevices.enumerateDevices()` → mic dropdown, saved by `deviceId` with the label as a fallback.
- Constraints: `echoCancellation: false`, `noiseSuppression: true`, `autoGainControl: true`.
- An AudioWorklet downsamples to 16 kHz mono Int16 and posts about 100 ms chunks to the worker port.
- Show an input level meter in the UI so the streamer can see the mic is live.

### 5.3 STT worker
```ts
interface ISttEngine {
  init(opts: { modelDir: string; sampleRate: 16000 }): Promise<void>;
  accept(pcm: Int16Array): void;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;   // fired on endpoint (≈600–800 ms silence)
  reset(): void;
  dispose(): void;
}
```
- **Sherpa engine (default):** streaming Zipformer en model. Turn on endpoint detection with rule2 trailing silence ≈ 0.8 s. Add a **hotwords** boost for the wake word and command verbs ("jim", "poll", "end", "predict") so they're recognized more reliably.
- **Whisper engine (optional):** a VAD (silero via sherpa-onnx) cuts the audio into utterances, and whisper.cpp transcribes each one. Default to `base.en` and allow `small.en`. Use the GPU when available.
- On first run, download the model with checksum verification and show progress in onboarding. Save it under `app.getPath('userData')/models`.

### 5.4 Command router & grammar
- Normalize text: lowercase, strip punctuation, collapse whitespace, turn spoken numbers into digits ("two minutes" → 120 s).
- Wake word: configurable, default `jim`, with a user-editable alias list (`gym`, `jem`, `gem`). The wake word must come first in the utterance or follow a pause of 1.5 s or more. This keeps "...told Jim to poll..." mid-sentence from triggering.
- Grammar (pure functions, unit-tested):

| Utterance | Action |
|---|---|
| `jim poll <a> or <b> [or <c>…]` | Create poll; title = `"A or B?"`; 2–5 choices |
| `jim poll <title> options <a> or <b>` | Create poll with a custom title |
| `jim poll <a> or <b> for <n> minutes/seconds` | Set duration (clamped to 15–1800 s) |
| `jim end poll` | `PATCH /helix/polls` status `TERMINATED` |
| `jim cancel poll` | `PATCH` status `ARCHIVED` (hidden from viewers) |
| `jim repeat poll` | Re-run the last poll |
| `jim predict <a> or <b>` *(Phase 3)* | Create prediction (2 outcomes, default window 120 s) |
| `jim lock prediction` / `jim <a> wins` *(Phase 3)* | Lock / resolve |

- **Presets:** users can define shortcuts like `"jim poll match"` → title "Win or Loss?", choices Win/Loss, 90 s.
- Limits: title ≤ 60 characters, choice ≤ 25 characters, Title Case for choices.
- Guards: cooldown (default 15 s), ignore if a poll is already active (use the EventSub state), and require at least 2 choices.
- **Confirm mode (optional setting):** instead of firing right away, show a toast with a 3 s countdown; "jim cancel" or a hotkey stops it.

### 5.5 Twitch service
- `createPoll({ title, choices, duration, channelPointsPerVote? })`, `endPoll(id, status)`, `getActivePoll()`.
- Turn API errors into clear messages: 400 (validation), 401 (re-auth), 403 (not affiliate / missing scope), 409/400 for a poll already active.
- Retry once on 5xx or a network error, with jitter. Never retry a 4xx.

### 5.6 EventSub (WebSocket)
- Subscribe to `channel.poll.begin`, `.progress`, `.end` (and the prediction events in Phase 3).
- Uses: track active poll state, show live vote bars in the dashboard, and feed the optional overlay.

### 5.7 UI (Angular)
- **Onboarding:** Twitch sign-in → mic picker with level meter → model download → "say 'Jim, poll yes or no' to test" (in dry-run mode).
- **Dashboard:** big listening toggle, wake-word status, live partial transcript, active poll card with live results, and an activity log (heard → parsed → API result).
- **Settings:** wake word and aliases, cooldown, default duration, Channel Points voting, confirm mode, presets editor, STT engine and model, hotkeys, start with Windows, minimize to tray.
- **Dry-run toggle:** parse and log, but don't call Twitch.
- **Manual input box:** type a command to test without speaking.

### 5.8 Hotkeys & tray
- Global hotkeys (configurable): mute/unmute listening, push-to-talk mode, end the active poll, cancel a pending confirm.
- Tray icon colors: green = listening, gray = muted, red = auth/mic error.

## 6. Phases

**Phase 0: Scaffold (½ day)**
- electron-vite + Angular renderer, strict TS, ESLint/Prettier, typed IPC, secure window defaults.
- Done when the app launches, the tray works, and settings save.

**Phase 1: Twitch plumbing (1 day)**
- Device Code Flow, token storage and refresh, validate loop, broadcaster lookup and eligibility check.
- Manual input box → grammar → `createPoll`, plus dry-run.
- Done when typing "jim poll win or loss" creates a real poll.

**Phase 2: Voice (1–2 days)**
- Mic capture worklet, utilityProcess worker, sherpa engine, model download.
- Endpointing, hotword boost, live transcript, wake-word rules, cooldown.
- Done when speaking the command creates a poll within 2 s, and 10 minutes of normal talking (no wake word) causes zero false triggers.

**Phase 3: Live state & more commands (1 day)**
- EventSub WebSocket, active poll card, end/cancel/repeat, presets, confirm mode.
- Predictions (create/lock/resolve).

**Phase 4: Polish & ship (1 day)**
- Onboarding flow, hotkeys, start with Windows, error banners, logs (rotating file under userData).
- Optional Whisper GPU engine.
- electron-builder Windows installer; auto-update via GitHub Releases.

**Stretch**
- OBS browser-source overlay served from `http://127.0.0.1:<port>/overlay` (live poll bars, "Jim heard you" toast).
- Multiple wake words / per-mod voice profiles.
- Chat fallback: mods type `!jim poll a or b` (with the `user:read:chat` scope).

## 7. Testing
- **Unit:** grammar parser (table-driven: 50+ phrasings, mishearings, edge cases like "win or loss or draw or tie or forfeit or other" → capped at 5), title/choice truncation, cooldown logic, token refresh rotation.
- **STT harness:** a folder of recorded WAV clips (commands + false-positive chatter + game audio bleed), run through the engine in CI with expected parse results. Track the wake-word hit rate and false-trigger rate.
- **Integration:** mock the Helix API with msw/nock. Optionally test against the Twitch CLI mock API (`twitch mock-api`).
- **E2E smoke:** Playwright for Electron: launch → dry-run → type a command → log entry appears.

## 8. Risks & mitigations
| Risk | Mitigation |
|---|---|
| "Jim" misheard / missed | Hotword boost, alias list, optional Whisper engine, "Hey Jim" alternative wake phrase |
| False triggers from game audio or friends on Discord | Capture only the chosen mic, wake word must start the utterance, cooldown, confirm mode |
| Native addon build pain (sherpa/whisper) on Electron ABI | Use prebuilt binaries; `@electron/rebuild` in postinstall; isolate in utilityProcess |
| Public-client refresh tokens are single-use | Save every refreshed token atomically before using it |
| Non-affiliate channels | Detect at sign-in and explain clearly |

## 9. Open decisions
1. Should commands fire right away by default, or should confirm mode be on by default?
2. Should mods be able to trigger by voice (multiple mics), or only the streamer?
3. Include predictions in v1, or ship polls only?
4. Is the app name final, or is "Jim" just the default wake word in a more generic app?
