# Jarvis · Jezero voice-assistant specification

> NASA Space Apps Challenge Madrid · Demo 1 · Original design captured from commit `cbc6b29` on 2026-11-14.
>
> This is the historical rehearsal specification. The product later adopted the name SARA, right-grip push-to-talk and additional mission context. See [the current technical documentation](DOCUMENTATION.md) for the shipped controls, configuration and architecture.

## 1. Scope and deliverable

Record a Quest 2 session in which an astronaut collecting sediment in Jezero gets an unsolicited dust advisory, asks two to four questions in English and returns to shelter. A teammate wears the headset and can repeat a take. The original deadline was under 12 hours, with an expected budget of $0–5. The fixed storm procedure, HiRISE terrain and Perseverance MEDA reference make repeated takes consistent.

The original scope excluded continuous listening, wake words, multiple languages, persistent audio or conversations and position tracking from the scene. A scripted recording was the first deliverable, followed by laptop voice and then headset voice. Stable public hosting and the second mission came later.

## 2. Architecture and scene contract

The Quest Browser runs the WebXR scene and `src/lib/jarvis/` in the same SvelteKit app. The browser captures audio, plays replies and owns telemetry and conversation history. Server routes hold credentials and call Groq Whisper, Claude Haiku 5.5 and ElevenLabs. The laptop hosts Vite over USB reverse forwarding or operates the fixed cue panel. The original design reserved the right controller's A button for speech and the trigger for sampling.

| Scene action | Module call |
| --- | --- |
| Enter VR, before requesting the XR session | `assistant.unlock()` |
| Push-to-talk press and release | `assistant.pttDown()`, `assistant.pttUp()` |
| Start or restart a take | `assistant.notify('mission_start')` |
| Sample or storm event | `assistant.notify('sample_collected')`, `assistant.notify('storm_start')` |
| Subscribe to captions | `assistant.onSubtitle(({ speaker, text }) => …)` |

The scene and assistant share spawn, sample, habitat, route waypoints, total distance, walking speed (1.0 m/s) and compass bearing in metres in terrain x/z space. The original design put these in `src/lib/mission.ts`, with fixed audio generated from the same values. The historical rehearsal constants now live under `src/lib/missions/vr-rehearsal/`.

The original scene used an orbit camera and a 10 m near plane. The VR design called for about 0.05 m, WebXR rendering through `setAnimationLoop`, unexaggerated 1× relief and an aesthetic review of the 16 m terrain grid. Confirm the actual controller mapping on the headset.

## 3. Voice pipeline

### Capture and transcription

Request a single persistent microphone stream inside the Enter VR gesture, before `requestSession`, with echo cancellation and noise suppression. Start a separate MediaRecorder clip on each press, await the final `dataavailable` on release and discard clips under 600 ms. Check support for WebM/Opus. Send raw binary with its actual content type to `POST /api/stt`.

Convert to multipart for Groq Whisper, with `ptt.webm`, `whisper-large-v3-turbo`, English language and a vocabulary prompt for Jezero, Perseverance, MEDA, habitat, airlock, sample, dust storm, oxygen, suit power and visibility. Empty or common hallucinated results become `{ text: '' }`. The client plays E01 without calling chat.

### Chat and speech

`POST /api/chat` accepts the transcript, telemetry and six recent turns. The original request used `claude-haiku-5-5`, low reasoning effort and a 2,000-token budget. Cache the static system prefix with ephemeral cache control. Dynamic readings belong inside the user message's `<telemetry>` block. Handle provider errors and refusals with E02. The current implementation can also return visor actions.

`POST /api/tts` accepts `{ text }` and produces MP3. Choose a fixed pre-made voice and cache speech by content. The original cache keyed on a text hash and the shipped cache also includes the voice and model. Browser `speechSynthesis` is a development and failure fallback. Captions remain available when speech fails. Credit the recording as **Voice: ElevenLabs**.

One AudioContext unlocks with silence and plays all output. Event lines have priority and cancel pending turns. Push-to-talk interrupts speech. Ignore extra presses during requests and sound a busy cue. Discard stale responses using a turn ID. The original expected latency was 2–4 seconds, with roughly 0.5 s for STT, 1 s for chat and 1 s for TTS. A receipt chirp and editing can cover pauses.

## 4. Assistant behavior

Use calm, precise English in at most two sentences. Cite the current protocol step and one known reading where useful. Give a brief answer to unrelated questions and lead back to the current action. Use the supplied telemetry and references for figures and acknowledge missing information.

The rehearsal protocol below is a simulation design. Visibility, energy demand and dust are the hazards it models.

| Step | Name | Action |
| --- | --- | --- |
| P1 | STOP & SECURE | Stop sampling and secure equipment and any completed sample |
| P2 | SUIT CHECK | Confirm helmet seal, lights and locator |
| P3 | POWER SAVE | Reduce nonessential loads |
| P4 | RETURN | Follow the marked route and stated bearing to the habitat |
| P5 | HOLD IF BLIND | Below 20 m visibility, hold, ping the beacon and wait for guidance |
| P6 | AIRLOCK | Within 10 m, enter the airlock and remove dust before entry |

P1–P4 start 0, 15, 30 and 45 seconds after the storm cue. The operator can force steps 1–6. The historical oxygen baseline was 312 minutes with 1.5× storm consumption. Suit power starts at 64% and declines at 0.01%/s in calm and 0.05%/s in storm. Visibility declines exponentially from 10,000 m toward 15 m. Rehearsal distance decreases at the assumed walking speed from P4, independently of player movement.

### Prerecorded lines

| ID | Cue | Original English draft |
| --- | --- | --- |
| L01 | `mission_start` | "Jarvis online. Sample site is ahead; surface temperature {air_temp_c} degrees, conditions nominal." |
| L02 | `sample_collected` | "Sample logged. Seal it and prepare to head back." |
| L03 | `storm_start` | "Warning: dust storm front approaching from the west. Protocol step one: stop sampling and secure the sample now." |
| L04 | `storm_start` + 30 s | "Visibility is dropping fast. Switch on your lights and beacon, and save suit power." |
| L05 | P5 | "Visibility under twenty metres. Hold position. I have your beacon." |
| L06 | P6 | "Airlock in range. Dust off before you enter. Well done." |
| E01 | Empty STT result | "Say again, I didn't copy." |
| E02 | Chat error | "Comms are degraded. Follow the protocol: return to the habitat." |
| Q1–Q4 | Scripted operator questions | Fixed answers for the recorded exchange |

Generate fixed tracks with `scripts/gen_lines.ts` into `static/jarvis/`. Fill placeholders from the route and MEDA snapshot before generation.

## 5. MEDA data

The original spec allotted one hour to obtaining one real sol of Jezero MEDA data, with published ranges as fallback. Store the sol, timestamp, units, product references and missing readings explicitly. The sol 313 snapshot remains the source for some fixed voice lines.

Later decisions replaced snapshot-only telemetry with historical curves from NASA PDS. The script bins air temperature, pressure, wind, ground temperature and humidity into 144 local-time slots per sol. It keeps the latest published sol, a representative curve per 10° of Ls and the sol 313 storm. The scene clock supplies local solar time and season. The client interpolates by time, blends toward sol 313 over 60 seconds during the storm and resets conditions for the next take. Storm wind is unavailable after the documented sensor cutoff. Optical depth approaches a published episode peak and is a simulation input. Explain that MEDA is replayed from periodic PDS releases. [Data guide](src/lib/data/README.md)

## 6. Original delivery plan

| Stage | Deliverable and acceptance |
| --- | --- |
| Level 0 · About 2 h 15 min | Implement shared constants, AudioContext, fixed tracks, operator page, cue endpoint and reset. A remote operator can complete a scripted take. |
| Level 1 · About 4–5 h more | Build protocol, weather and telemetry, microphone capture, STT, chat, TTS and captions. Record a complete laptop exchange and test failures and interruptions. |
| Level 2 · About 2 h 15 min–3 h more | Forward Vite over USB, wire headset events and controls, check browser speech and record a two-minute Quest take with both voices. |
| Fallback | Record separately on the laptop or capture astronaut audio with a phone, then assemble in editing. The script remains recordable if voice services fail. |

Agree on the scene contract first and enable Quest developer mode and USB debugging in parallel. Audio unlock precedes fixed tracks and operator cues. Microphone capture and weather precede chat, which precedes generated speech, captions and headset integration.

### Recording and deployment

Run `adb devices` and `adb reverse tcp:5173 tcp:5173`. Open the Quest experience on localhost and use `chrome://inspect` when needed. The historical backup was a Cloudflare quick tunnel with an allowed host and a demo token. Disable hot reload for recording, confirm permissions and voice, reset the session, verify levels, trigger the storm cue and check the recording before the next take.

The later Cloudflare Workers deployment prerenders pages and runs the API on the Worker. `CueChannel` shares operator state. The TTS cache runs on the edge. Manage credentials as Worker secrets. Local Vite and USB still work. The public demo uses token access and voice rate limits.

## 7. Privacy, edge cases and verification

Keep keys in server-only environment variables. The historical tunnel design used `DEMO_TOKEN`, a ten-request-per-minute in-memory limit and a $5 Anthropic budget target. Close the tunnel after recording. The original app design discards microphone clips after transcription and keeps conversation history in the client. Providers process audio or text for their API calls.

| Case | Expected behavior |
| --- | --- |
| Accidental press or silent clip | Short clips are dropped. Empty transcription plays E01. |
| Press during speech | Stop playback and start recording. |
| Press during a pending request | Busy cue. |
| Storm cue during a response | Interrupt with the fixed warning and cancel the old turn. |
| Chat error or refusal | Play E02. |
| TTS error | Try browser speech, with captions available. |
| Retake | Reset clock, history and telemetry first. |
| Laptop and headset together | Only the operator cue is shared in the original design. |
| Provider quota exhaustion | Fall back to scripted cues. |

Check microphone permission, capture length and MIME, playback unlocking, event priority, cache hits, reset, captions, cue polling and a full headset recording. The original uncertainties were native microphone capture while the site holds the stream, Quest browser speech support, provider quotas, MEDA wind coverage and the rehearsal position approximation.

## 8. Decision record

All decisions below record the original November 14, 2026 design session and its follow-up.

| ID | Decision |
| --- | --- |
| D1–D5 | Record a sediment and storm mission with retakes before the deadline. Extend the existing WebXR scene with an isolated voice module. Use laptop audio in editing if necessary. |
| D6–D9 | Use server-side Groq Whisper, Claude Haiku 5.5 and ElevenLabs, browser speech fallback, push-to-talk and a fixed storm protocol. |
| D10–D13 | Integrate three scene events and simulated telemetry. Start with a single historical MEDA sol. Speak English. Deliver scripted, laptop live and Quest live in order. |
| D14–D15 | Keep the HTTPS tunnel as a fallback, protected by demo access, rate limiting and a provider budget. |
| D16–D18 | Use short flight-control responses and keep history client-side. Try Quest native audio capture at level 2 and keep phone audio as fallback. |
| D19–D22 | Prefer USB localhost. Unlock audio and the persistent microphone in the Enter VR gesture. Send checked raw clips and filter empty or spurious English transcripts. |
| D23–D26 | Reset state between takes. Reuse fixed voice tracks. The rehearsal bound speech to A and sampling to the trigger. Use one priority queue and echo cancellation. |
| D27–D30 | Share route constants, relay operator cues with 500 ms polling, ground the storm protocol in visibility and power, and deploy APIs on Workers with Durable Object cues and edge caching. |
| D31–D35 | Replay historical seasonal MEDA curves using scene time. Blend to sol 313 during the storm. Describe provenance and light-time delay in the prompt. Refresh via a reviewable workflow, with scheduled Cloudflare storage left as an option. |
| D36–D38 | Load the Markdown briefing at startup, strip HTML comments, use one system prompt and send mission state as telemetry data. |
| D39–D40 | Use SARA in the product and preserve the `jarvis` code identifiers. Choose the ElevenLabs Sarah voice and regenerate the twelve fixed tracks. |
