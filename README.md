# Explorador de Jezero

Visor 3D del delta occidental de Jezero. Ejecuta `npm ci` y `npm run dev` y abre la URL que muestra Vite. El visor requiere WebGL 2 y carga la cuadrícula incluida en el repositorio.

Al cargar apareces a pie en el delta. Haz clic en la escena (o pulsa **Intro** con el visor enfocado) para girar con el ratón y usa **WASD** para caminar. Pulsa **Esc** para liberar el ratón. También puedes arrastrar sobre el visor o usar las flechas para mirar. El minimapa muestra el relieve local y tu rumbo. El oxígeno y la temperatura son valores simulados.

En equipos de escritorio compatibles, el visor carga el terreno de mayor resolución en segundo plano y lo aplica si todavía no has empezado a explorar.

El casco muestra la hora solar media local de Jezero. Pulsa **H** y abre **Cambiar hora** para explorar otro sol u otra hora. **Volver a la hora actual** reanuda el reloj en directo.

## Meta Quest 2

Abre la portada en el navegador de las Quest por HTTPS y pulsa **Enter VR**. Mira a tu alrededor moviendo el visor, camina con el joystick izquierdo y mantén pulsado el gatillo derecho para hablar con SARA.

Para probar desde el PC por USB, activa el modo desarrollador en el visor y acepta la depuración USB. Con Vite en el puerto 5173, ejecuta `adb reverse tcp:5173 tcp:5173` y abre `http://localhost:5173/` en el navegador de las Quest.

## Despliegue en Cloudflare Workers

En **Settings → Build**, usa la raíz del repositorio, `npm run build` como comando de compilación y `npx wrangler deploy` como comando de despliegue (no cambian).

La compilación usa `@sveltejs/adapter-cloudflare`. Las páginas siguen pre-generadas como recursos estáticos y las rutas `/api/*` del asistente SARA se ejecutan en el Worker. La salida va a `.svelte-kit/cloudflare`, donde `wrangler.jsonc` apunta el worker y los recursos. `scripts/cf-postbuild.js` añade al worker el Durable Object `CueChannel`, que es el canal de cues del operador.

**Secretos del Worker:** se configuran en el panel de Workers (Settings → Variables and Secrets) o con `npx wrangler secret put <NOMBRE>`:

| Nombre | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Haiku 5.5 (`/api/chat`). Conviene poner un tope de gasto en la consola de Anthropic. |
| `GROQ_API_KEY` | Whisper (`/api/stt`) |
| `ELEVENLABS_API_KEY` | Voz de SARA (`/api/tts`) |
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

## Datos del clima de SARA (MEDA)

SARA cita temperatura, presión, humedad y temperatura del suelo reales, medidas por la estación MEDA del rover Perseverance. **MEDA no tiene un feed en vivo.** Sus datos se publican en el PDS de la NASA por lotes, unas tres veces al año. `src/lib/data/meda-curves.json` guarda curvas diarias reales con un punto cada 10 minutos de hora local: la del último sol publicado, una por cada estación marciana (intervalos de 10° de Ls) y la del sol 313, cuando llegó la tormenta de polvo de enero de 2022. SARA reproduce la curva de la misma estación a la hora del reloj del visor y, en la tormenta, pasa a la curva del sol 313. También calcula el retardo de la señal entre la Tierra y Marte. Los detalles, las fuentes y las comprobaciones están en [`src/lib/data/README.md`](src/lib/data/README.md).

**Actualizar tras una nueva entrega del PDS:**

```sh
npm run data:meda   # descarga solo lo nuevo (caché en .cache/meda, fuera de git) y reescribe meda-curves.json
```

Revisa el resumen que imprime, ejecuta `npm run build` y haz commit del JSON. El texto del prompt toma el último sol publicado al arrancar, así que hay que reiniciar `npm run dev` o volver a desplegar.

**Refresco automático (opcional):**
- **GitHub Action (plantilla incluida):** copia `scripts/meda-refresh.workflow.yml` a `.github/workflows/meda-refresh.yml` y haz commit (subir ficheros de workflow requiere un token con el permiso `workflow`, por ejemplo `gh auth refresh -s workflow`). Se ejecuta cada lunes (y a mano desde *Actions → Refresh MEDA curves → Run workflow*). Solo usa el `GITHUB_TOKEN` por defecto y abre un PR si hay datos nuevos. Para que pueda crear el PR, activa *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*. La primera ejecución descarga unos 500 MB del PDS y las siguientes usan la caché.
- **Cloudflare Cron Trigger + KV (no implementado, es un paso futuro):** (1) `npx wrangler kv namespace create MEDA` y añadir el binding `kv_namespaces: [{ "binding": "MEDA", "id": "<id>" }]` a `wrangler.jsonc`. (2) Añadir `"triggers": { "crons": ["0 6 * * *"] }` y un handler `scheduled` en `scripts/cf-postbuild.js` que ejecute la misma reducción que `scripts/build_meda.ts` y escriba el JSON en KV. Los CSV de un sol pesan unos 15 MB, así que conviene limitarse a comprobar si hay un sol nuevo y procesar solo `latest`. (3) Hacer que el cliente lea las curvas de un endpoint `/api/meda` respaldado por KV, con `meda-curves.json` como reserva. Nada de esto se ha creado en la cuenta de Cloudflare.

## ARES-01 · The Last Sample

Open **ARES-01 · The Last Sample** from the free exploration visor or visit `/missions/ares01`. Press **I** there to start the interactive mission. Use **WASD** to walk or drive and hold the **arrow keys** to look around. Press **E** or **1** for the first action and **2** for the second. **P** pauses or resumes. While paused or after completing the mission, **R** restarts and **Q** exits.

Hold **Space** to speak to SARA and release it to send. **English is the language of the entire app. SARA always speaks and replies in English, including in both missions.** Add `?tts=browser` to the visor URL to use an English browser voice.

The interactive mission follows your position and actions over the full route, including the 2.4 km rover drive. Dust advisories trigger 20 and 40 seconds after drilling starts. Dust, slope hazards and suit pressure are simulated. Route coordinates are in `src/lib/missions/ares01/route.ts` and the mission emits `ares01:dialogue` events.

## Project layout

Inside the rover in either mission, **W/S** drives forward and in reverse and **A/D** steers. The mouse and arrow keys look around the cabin independently. The dashboard shows the map, speed and heading. The headlights follow the rover heading.

### ARES-02 · Nightfall Protocol

Open `/missions/ares02` and press **I**. Switch on the headlights and follow the curved ground guide with **WASD**. Use **E / 1 / 2** to operate the rover and confirm actions. The playable drive is about 200 m along the detour. The rover is limited to 10 km/h and to 8 km/h in degraded drive. After a successful isolation check, follow SARA in English: secure the rover, check the suit, exit through the airlock, walk to the amber service marker, open the panel, reseat battery A’s low-voltage control link, and latch the panel. Walk back to the airlock, reboard, and test the battery A bus before comparing routes. At Bravo, park, retrieve the module and carry it to the entrance on foot. The parked rover uses the same SEV model as ARES-01.

- `src/lib/missions/ares01/` contains the mission timeline, interactive logic, controls, scene and SARA instructions. Its models are in `static/models/missions/ares01/`.
- `src/lib/missions/vr-rehearsal/` contains the route and telemetry constants for the VR rehearsal.
- `src/lib/visor/` contains the terrain renderer, visor optics and Mars clock.
- `src/lib/jarvis/` and `src/lib/server/jarvis/` contain the assistant client and server services.
