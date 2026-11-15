# ARES overview

A 3D explorer of the Jezero delta with free exploration, two interactive missions, Meta Quest 2 support and a voice assistant called SARA. SARA answers questions using simulated telemetry and Mars 2020 measurements. Built for NASA Space Apps Challenge Madrid 2026.

[Quick start](README.md) · [Technical documentation](DOCUMENTATION.md) · [Data and asset credits](RESOURCES.md)

## Features

- **Free exploration.** Traverse a HiRISE digital terrain model with a minimap, flashlight, Mars clock, MEDA weather, hazard overlays and simulated infrared.
- **ARES-01 · The Last Sample.** Drill a core and return to the rover as a dust storm grows.
- **ARES-02 · Nightfall Protocol.** Drive at night, deal with an electrical fault, service the exterior battery bay and deliver a module to Bravo within the energy budget.
- **SARA.** Push-to-talk transcription, Claude with tool calls and text-to-speech, with a scripted fallback. Voice commands can operate the map, infrared, hazard layer and flashlight.
- **VR and spectator view.** WebXR controller menus, a stereo HUD and a rover cabin. A PC renders the spectator scene from headset pose and mission state relayed by WebSocket.
- **Operator panel.** A shared cue channel for rehearsals and recordings.

## Architecture

The browser handles rendering, mission state and telemetry. Cloudflare Workers serve prerendered pages and run the API routes. Voice credentials remain server-side. The operator cue channel and spectator sessions use the `CueChannel` and `ShareRoom` Durable Objects.

Svelte 5, SvelteKit, Vite and TypeScript power the UI. Three.js renders the world with WebGL 2. The voice pipeline sends push-to-talk audio to `/api/stt` (Groq Whisper), then sends the transcript and scene context to `/api/chat` (Claude Haiku 5.5). It plays the response from `/api/tts` (ElevenLabs) through Web Audio and supports interruption.

## Routes and options

| Route | Purpose |
| --- | --- |
| `/` | Free exploration |
| `/missions/ares01` | ARES-01 |
| `/missions/ares02` | ARES-02 |
| `/vr-test` | Quest entry point |
| `/spectator` | Live spectator view |
| `/operator` | Client-side operator panel |
| `/api/stt`, `/api/chat`, `/api/tts` | SARA voice pipeline |
| `/api/cue` | Operator cues |
| `/api/vr-share` | Spectator rooms |

Useful query parameters include `?tts=browser`, `?mode=scripted`, `?remote=1`, `?test=1` and `?k=<token>`.

## Mission and simulation details

- **ARES-01.** The rover starts 70 m from the sample site. The detour adds 13 m, the scenario hazard rock has a 6.4 m radius and the base is 2.4 km from the rover.
- **ARES-02.** The usable battery has 9.5 kWh and the scenario reserve is 9.15 kWh. The direct route preserves the reserve. The exterior service addresses module A and degraded drive is limited to 8 km/h.
- **Terrain and weather.** The HiRISE grid has 434 × 722 nodes at 16.154 m spacing, or 867 × 1443 nodes at 8.08 m in high resolution. MEDA curves use historical observations in 10-minute bins and blend toward sol 313 during the simulated storm.
- **Hazard score.** Slope contributes 0.30, soil 0.20, rock 0.15, relief 0.10, temperature 0.15 and visibility 0.10. Warnings start at 20% and 40%. The colour ramp reaches amber at 0.33 and red at 0.575.
- **SWIR.** The visor simulates a monochrome 1.65 µm image. Energy, oxygen and hazard estimates are also simulated. Moon positions and twilight are approximate.

## Development

```sh
npm ci
npm run dev
npm run check
npm run build
npx wrangler deploy
```

Missing voice-service credentials produce a 503 from the corresponding endpoint. See the [README](README.md) for environment variables and deployment. The demo supports access by query token, header or HTTP-only cookie. Voice endpoints enforce rate limits and validate inputs.

The `missions/vr-rehearsal/` directory contains shared route constants. Use `npm run cf:dev` for local testing of the single-spectator relay. See [TESTING.md](TESTING.md) for manual mission walkthroughs.
