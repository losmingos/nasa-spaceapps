# Explorador de Jezero

Visor 3D del delta occidental de Jezero. Ejecuta `npm ci` y `npm run dev` y abre la URL que muestra Vite. El visor requiere WebGL 2 y carga la cuadrícula incluida en el repositorio.

Al cargar apareces a pie en el delta. Haz clic en la escena (o pulsa **Intro** con el visor enfocado) para girar con el ratón y usa **WASD** para caminar. Pulsa **Esc** para liberar el ratón. También puedes arrastrar sobre el visor o usar las flechas para mirar. El minimapa muestra el relieve local y tu rumbo. El oxígeno y la temperatura son valores simulados.

El casco muestra la hora solar media local de Jezero. Pulsa **H** y abre **Cambiar hora** para explorar otro sol u otra hora. **Volver a la hora actual** reanuda el reloj en directo.

## Despliegue en Cloudflare Workers

En **Settings → Build**, usa la raíz del repositorio, `npm run build` como comando de compilación y `npx wrangler deploy` como comando de despliegue (no cambian).

La compilación usa `@sveltejs/adapter-cloudflare`. Las páginas siguen pre-generadas como recursos estáticos y las rutas `/api/*` del asistente Jarvis se ejecutan en el Worker. La salida va a `.svelte-kit/cloudflare`, donde `wrangler.jsonc` apunta el worker y los recursos. `scripts/cf-postbuild.js` añade al worker el Durable Object `CueChannel`, que es el canal de cues del operador.

**Secretos del Worker:** se configuran en el panel de Workers (Settings → Variables and Secrets) o con `npx wrangler secret put <NOMBRE>`:

| Nombre | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Haiku 5.5 (`/api/chat`). Conviene poner un tope de gasto en la consola de Anthropic. |
| `GROQ_API_KEY` | Whisper (`/api/stt`) |
| `ELEVENLABS_API_KEY` | Voz de Jarvis (`/api/tts`) |
| `ELEVENLABS_VOICE_ID` | ID de una voz predefinida |
| `DEMO_TOKEN` | **Obligatorio en la URL pública.** Sin él, cualquiera puede gastar los créditos. Abre las páginas con `?k=<token>`. |
| `ELEVENLABS_MODEL_ID` | Opcional (por defecto `eleven_flash_v2_5`) |

**Probar en local como en Workers:** copia `.env` a `.dev.vars` (está fuera de git) y ejecuta `npm run cf:dev`. Para desarrollar, `npm run dev` sigue funcionando igual: los cues van en memoria y la caché de voz se guarda en disco.

## Datos del terreno

[DTM HiRISE del delta de Jezero](https://www.uahirise.org/dtm/PSP_002387_1985), producto `DTEEC_002387_1985_003798_1985_A01`. Crédito NASA/JPL-Caltech/Universidad de Arizona.

La cuadrícula incluida conserva una muestra por cada 16 filas y columnas del DTM. Tiene 434 × 722 muestras, separadas por 16,15 m según la escala del PDS3. Su extensión rectangular es de aproximadamente 7 × 11,6 km. El visor omite los triángulos que contienen muestras sin datos. Las elevaciones están en metros respecto al datum Marte 2000. El visor proyecta el ortomosaico HiRISE sobre la malla. Consulta [RESOURCES.md](RESOURCES.md) para ver los productos, créditos y pasos de preparación.

Para regenerar el binario, descarga el IMG desde la ficha de HiRISE y ejecuta:

```sh
python scripts/build_terrain.py ruta/al/DTEEC_002387_1985_003798_1985_A01.IMG
```

## ARES-01 · The Last Sample

Press **I** to start the interactive mission. Use **WASD** to walk or drive and hold the **arrow keys** to look around. Press **E** or **1** for the first action and **2** for the second. **P** pauses or resumes. While paused or after completing the mission, **R** restarts and **Q** exits.

Hold **Space** to speak to JARVIS and release it to send. Mission announcements and conversational replies are in English. Add `?tts=browser` to the visor URL to use an English voice installed in your browser or operating system.

**Watch demo** plays the guided sequence in 3:30. The interactive mission follows your position and actions over the full route, including the 2.4 km rover drive. Dust advisories trigger 20 and 40 seconds after drilling starts. Dust, slope hazards and suit pressure are simulated. Route coordinates are in `src/lib/missions/ares01/route.ts` and the mission emits `ares01:dialogue` events.

## Project layout

- `src/lib/missions/ares01/` contains the mission timeline, interactive logic, controls, scene and JARVIS instructions. Its models are in `static/models/missions/ares01/`.
- `src/lib/missions/vr-rehearsal/` contains the route and telemetry constants for the VR rehearsal.
- `src/lib/visor/` contains the terrain renderer, visor optics and Mars clock.
- `src/lib/jarvis/` and `src/lib/server/jarvis/` contain the assistant client and server services.
