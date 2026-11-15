# ARES · SARA and the Jezero Explorer

ARES recreates an astronaut's fieldwork on Mars in a browser and on Meta Quest 2. Explore the western delta of Jezero Crater, where NASA's Perseverance rover has collected samples. We chose the delta because it once fed an ancient lake and its sediments may preserve signs of past life. The science objective in the first mission is to collect a sediment core.

SARA, named after Spanish astronaut Sara García Alonso, is the voice assistant in the visor. It answers questions about the mission, gives directions back to the rover when position data is available, and recommends when to end a spacewalk. The project explores how a crew could rehearse emergencies and get immediate, hands-free guidance during a communications delay while retaining the final decision.

Built by Los Mingos for NASA Space Apps Challenge Madrid. [Hosted demo](https://sara.alvarov.workers.dev/)

## Missions

- **ARES-01 · The Last Sample.** A dust storm intensifies while the astronaut is drilling. Secure the equipment, return to the pressurized rover and take a surveyed detour around unstable ground. The rover is initially 70 m from the sample site, and the detour adds 13 m. From the rover, the route back to base is 2.4 km.
- **ARES-02 · Nightfall Protocol.** Drive a replacement module to Bravo Station at night. A battery fault forces you to secure the rover, inspect the exterior battery bay, recover degraded drive and choose a route that preserves the emergency energy reserve.
- **Free exploration.** Walk across the delta, change the local Mars time and inspect terrain using the map, terrain hazard layer and simulated short-wave infrared (SWIR) mode.

Hold push-to-talk to ask SARA about your next action, weather or mission telemetry, or to request the flashlight, SWIR mode, hazard layer or a map zoom adjustment. SARA uses the current scene state and draws on documented Apollo surface procedures, ISS EVA experience and NEEMO communication-delay studies for the ARES-01 guidance. [ARES-01 flight rules and sources](src/lib/server/jarvis/flight-rules.md)

## Run locally

Use Node.js 24 and npm. The browser needs WebGL 2. The default terrain is bundled, and desktop clients may load a higher-resolution version in the background.

```sh
npm ci
npm run dev
```

Open the local URL shown by Vite. Terrain exploration and mission controls are available without voice-service keys. For live voice, set the service variables below in an untracked `.env` file. Grant microphone access when prompted.

| Page | What to open |
| --- | --- |
| `/` | Explore Jezero and open mission briefings |
| `/missions/ares01` | Play The Last Sample or review its scripted sequence |
| `/missions/ares02` | Play Nightfall Protocol or review its scripted sequence |
| `/vr-test` | Enter VR on a compatible headset |
| `/spectator` | Join the headset's shared view using a room code |
| `/operator` | Trigger scripted voice cues during a recording |

On desktop, click the scene to capture the mouse, move with **WASD** and use **Esc** to release the mouse. The arrow keys also turn the view. Press **H** to open the scene controls, **F** for the flashlight, and hold **Space** to talk to SARA. On a mission page, press **I** to start the interactive mission, **E** or **1** for the first action and **2** for the second. **P** pauses or resumes. While paused or after completing the mission, **R** restarts and **Q** exits.

## Meta Quest 2 and spectator view

1. Open `/vr-test` in Quest Browser over HTTPS and select **Enter VR**. Use the left stick to move or drive and the right stick to turn. Hold the **right grip** to talk to SARA and release it to send. Use the triggers to select actions.
2. Press **A** and choose **Visor settings → Share view → Create code**. Open `/spectator` on a PC using the same deployment and enter the code.
3. The spectator page renders the headset's first-person view, mission state, HUD, menus and subtitles. It also plays the push-to-talk commands and SARA's replies. Choose **Full screen** or mute the audio from the toolbar. Each room supports one spectator.

For USB development, enable developer mode on the headset, accept the USB debugging prompt, run `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173/vr-test` on the headset. To exercise the Cloudflare relay locally, use `npm run cf:dev`.

## Mars data and simulation

| Data | How ARES uses it |
| --- | --- |
| HiRISE elevation and imagery | The elevation model and orthomosaic cover roughly 7 × 11.6 km of the western delta. The terrain mesh uses 16.15 m sample spacing by default, with an 8.08 m higher-resolution option. |
| USGS geologic map SIM 3464 | Regional geologic units inform the terrain hazard layer alongside slope, surface roughness and conditions in the scene. |
| Perseverance MEDA weather | Archived measurements from NASA's Planetary Data System are replayed at the scene's local solar time and season. The dust storm draws on sol 313 observations from January 2022. |
| NASA 3D Resources | Adapted models include the Space Exploration Vehicle, the Mars 2020 sample tube and parts of the Habitat Demonstration Unit. |

The mission events, suit telemetry, rover power budget, dust progression and SWIR image are simulated. The hazard layer provides an estimate at the scale of the available data. ARES is a hackathon prototype for exploring and rehearsing scenarios. [Data products, asset credits and regeneration steps](RESOURCES.md) · [MEDA processing notes](src/lib/data/README.md)

Run `npm run data:meda` after a new PDS release to regenerate `src/lib/data/meda-curves.json`. The script caches downloads under `.cache/meda`. Review the updated data and restart the dev server or redeploy to load it. An optional GitHub Actions workflow template is in [scripts/meda-refresh.workflow.yml](scripts/meda-refresh.workflow.yml).

## Voice services and deployment

SvelteKit and Svelte 5 provide the UI and API routes. Three.js and WebXR render the same terrain in desktop and headset browsers. Groq Whisper transcribes push-to-talk audio, Claude Haiku 5.5 receives the transcript and scene context, and ElevenLabs provides speech. The `?tts=browser` option uses browser speech synthesis for playback. Cloudflare Durable Objects relay operator cues and spectator state.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | SARA's chat and visor commands |
| `GROQ_API_KEY` | Microphone transcription |
| `ELEVENLABS_API_KEY` | SARA's generated speech |
| `ELEVENLABS_VOICE_ID` | ElevenLabs premade voice ID |
| `ELEVENLABS_MODEL_ID` | Optional model override. Defaults to `eleven_flash_v2_5` |
| `DEMO_TOKEN` | Protects voice API access and spectator room creation. Set it on public deployments that use paid services and supply `?k=<token>` in the headset or desktop access link. Spectators only need the room code. |

For local Worker testing, put the variables in an untracked `.dev.vars` file and run `npm run cf:dev`. For deployment, configure secrets in **Workers → Settings → Variables and Secrets** or use `npx wrangler secret put <NAME>`. In Cloudflare's build setup, use the repository root with `npm run build` and deploy with `npx wrangler deploy`. The Worker and static assets build to `.svelte-kit/cloudflare`.

## Repository guide

| Path | Contents |
| --- | --- |
| `src/lib/visor/` | Terrain rendering, visor optics, WebXR and spectator sharing |
| `src/lib/missions/` | Mission scenes, routes, controls and timelines |
| `src/lib/jarvis/` and `src/lib/server/jarvis/` | SARA client, voice services, prompt and flight rules |
| `src/lib/data/` and `static/terrain/` | Processed weather and terrain assets |
| `scripts/` | Terrain and MEDA data pipelines, prerecorded voice generation and Cloudflare build support |

Run `npm run check` and `npm run build` before submitting changes. See [TESTING.md](TESTING.md) for desktop and headset test procedures.
