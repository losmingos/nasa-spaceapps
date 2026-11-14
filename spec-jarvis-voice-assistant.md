# Spec — Jarvis, asistente de voz de supervivencia en Jezero

> NASA Space Apps Challenge Madrid · Demo 1 · Capturado sobre el commit `cbc6b29` · 2026-11-14
> Responsable: asistente de voz. La escena WebXR la construye el resto del equipo.

## En un vistazo

| | |
|---|---|
| **Qué** | Un asistente de voz («Jarvis») que guía a un astronauta en el cráter Jezero cuando estalla una tormenta de polvo durante una misión de recogida de sedimento. |
| **Entregable** | Un **vídeo grabado**: un compañero lleva las Quest 2 y se repite la toma cuantas veces haga falta. |
| **Plazo** | Menos de 12 h de trabajo hasta grabar. |
| **Pipeline** | Pulsar para hablar (botón **A**) → Groq Whisper (gratis) → **Claude Haiku 5.5** (`claude-haiku-5-5`) → ElevenLabs (plan gratuito). |
| **Idioma de Jarvis** | Inglés. |
| **Dónde corre** | Un módulo dentro de la misma app SvelteKit que la escena WebXR. Las Quest acceden por USB + `adb reverse` a `localhost:5173`. |
| **Garantía de entrega** | Niveles: **0** guionizado (unas 2 h) → **1** en vivo en el portátil (unas 5 h) → **2** en vivo en las Quest (unas 3 h). |
| **Coste esperado** | 0–5 $: solo Claude se paga por uso, con un tope de gasto de 5 $ en la consola. |

---

## 1. Problema y objetivo

Durante la demo, el juez (en la grabación, un compañero) está en Jezero recogiendo una muestra de sedimento. De repente empieza una tormenta de polvo. Jarvis:

1. **Avisa por iniciativa propia** de que llega la tormenta y da la primera instrucción. No espera a que le pregunten.
2. **Responde a las preguntas** del astronauta («What do I do now?», «How far is the habitat?») siguiendo un **protocolo fijo** y citando cifras de telemetría.

**TL;DR:** que el vídeo transmita que un asistente de voz realista, basado en datos reales de Jezero, puede salvarle la vida a un astronauta.

### Objetivos
- Que la grabación muestre un intercambio creíble: el aviso de tormenta, 2–4 preguntas con sus respuestas y la vuelta al hábitat.
- Que las instrucciones sean **coherentes en todas las tomas**: salen del mismo protocolo, no de lo que improvise el LLM.
- Que se usen datos reales: el terreno es el DTM HiRISE que ya está en el repo, y el clima sale de una instantánea de **MEDA** (Perseverance).
- Que haya algo grabable en unas 2 h aunque falle todo lo demás (nivel 0).

### Fuera de alcance (demo 1)
- Escuchar todo el rato o reaccionar a una palabra clave.
- Que Jarvis conozca la posición real del jugador. La telemetría es simulada (D10).
- Más de un idioma.
- Despliegue público estable (Vercel o similar).
- Persistir audio o conversaciones.
- La demo 2: cualquier cosa más allá de la tormenta.

---

## 2. Arquitectura

```
┌──────────────────────────── Meta Quest 2 · Quest Browser (WebXR) ────────────────────────────┐
│                                                                                              │
│  Escena (equipo escena)                    Módulo Jarvis (src/lib/jarvis/)                   │
│  ───────────────────────                   ──────────────────────────────                    │
│  click «Enter VR» ─────────────────────▶   assistant.unlock()   → AudioContext + getUserMedia │
│  botón A pulsado / soltado ────────────▶   assistant.pttDown()/pttUp() → MediaRecorder      │
│  mission_start / sample_collected /  ──▶   assistant.notify(event) → telemetría + mp3 fijo  │
│  storm_start                                                                                 │
│  ◀── assistant.onSubtitle(cb) ──────────   texto de la pregunta y la respuesta (subtítulo)   │
│                                                                                              │
│  mission.ts  ◀────────── constantes compartidas (spawn, muestra, hábitat, ruta) ──────────▶ │
└───────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                            │  USB · adb reverse tcp:5173 tcp:5173
                                            ▼
┌──────────────────────── Portátil · vite dev (SvelteKit, localhost:5173) ─────────────────────┐
│  POST /api/stt   (cuerpo binario audio/webm) ──▶ Groq Whisper  ──▶ { text }                  │
│  POST /api/chat  (JSON: history, text, telemetry) ──▶ Claude Haiku 5.5 ──▶ { reply }         │
│  POST /api/tts   (JSON: text) ──▶ ElevenLabs (caché por hash) ──▶ audio/mpeg                 │
│  GET/POST /api/cue   canal del operador para el nivel 0 (la página lo consulta cada 500 ms)  │
│  /operator       página de control en el portátil (cues, reset, pulsar para hablar, log)     │
│  .env  ANTHROPIC_API_KEY · GROQ_API_KEY · ELEVENLABS_API_KEY  (solo en el servidor)          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**TL;DR:** las gafas solo graban el micrófono, reproducen audio y emiten eventos. Todo lo que necesita una clave corre en el portátil. **El servidor no guarda estado**: el cliente tiene el historial y la telemetría (D23).

### Distribución de ficheros

```
src/lib/mission.ts                 # constantes compartidas con la escena (D27)
src/lib/jarvis/types.ts            # contrato compartido: tipos de la API HTTP y del módulo
src/lib/jarvis/protocol.ts         # protocolo de tormenta (fuente única de verdad, compartido cliente/servidor)
src/lib/jarvis/api.ts              # fetch a /api/* (+ cabecera x-demo-token si la URL trae ?k=)
src/lib/jarvis/index.ts            # createAssistant(): API pública del módulo
src/lib/jarvis/audio.ts            # AudioContext único + cola con prioridad (D20, D26)
src/lib/jarvis/recorder.ts         # stream de micro persistente + MediaRecorder (D21, D22)
src/lib/jarvis/telemetry.ts        # telemetría simulada, reloj desde mission_start (D10, D23)
src/lib/jarvis/lines.ts            # catálogo de frases pregrabadas → static/jarvis/*.mp3
src/lib/server/jarvis/prompt.ts    # prompt de sistema fijo: personalidad + protocolo + MEDA
src/lib/data/meda-snapshot.json    # instantánea MEDA de un sol real (D11)
src/env.ts                         # declaración de variables de entorno (SvelteKit 3: defineEnvVars)
src/routes/api/stt/+server.ts
src/routes/api/chat/+server.ts
src/routes/api/tts/+server.ts
src/routes/api/cue/+server.ts
src/routes/operator/+page.svelte
src/routes/vr-test/+page.svelte    # arnés WebXR mínimo: integración de referencia + prueba D18
src/hooks.server.ts                # token de demo + límite de peticiones (solo con túnel, D15)
scripts/gen_lines.ts               # genera los mp3 fijos con ElevenLabs (una vez)
static/jarvis/*.mp3                # frases pregrabadas, en el repo (D24)
```

---

## 3. Contrato con la escena

Esto es lo único que el equipo de la escena tiene que implementar o respetar. **Hay que acordarlo en los primeros 15 minutos.**

### 3.1 API del módulo

```ts
import { createAssistant } from '#lib/jarvis/index.js';

const assistant = createAssistant({ mode: 'live' | 'scripted' }); // nivel 1–2 | nivel 0

// 1. En el MISMO click handler de «Enter VR», ANTES de navigator.xr.requestSession():
await assistant.unlock();          // crea y activa el AudioContext + getUserMedia (stream persistente)

// 2. Botón A del mando derecho, consultado cada frame en el XR loop:
assistant.pttDown();               // flanco de subida de gamepad.buttons[4] (A)
assistant.pttUp();                 // flanco de bajada

// 3. Eventos de misión:
assistant.notify('mission_start');     // pone a cero el historial y la telemetría (reset de toma)
assistant.notify('sample_collected');
assistant.notify('storm_start');

// 4. Subtítulos en VR (opcional pero recomendado):
assistant.onSubtitle(({ speaker, text }) => { /* panel de texto en el HUD */ });
```

- El botón **A** sirve **solo** para hablar. **El gatillo queda reservado para recoger la muestra** (D25).
- En el mando derecho de las Quest, el índice de A en `gamepad.buttons` es normalmente el 4 (*xr-standard mapping*). **Hay que comprobarlo en las gafas** con un `console.log` del array.
- `notify('mission_start')` también hace de **reset entre tomas** (D23). En el portátil, la tecla **R** de `/operator` hace lo mismo.

### 3.2 `src/lib/mission.ts` (D27)

```ts
// Coordenadas en el espacio de la malla de terrain.ts (x/z en metros, centrado en 0,0).
// Lo propone el responsable de Jarvis y lo valida el equipo de la escena. LAS CIFRAS DE LOS MP3 SALEN DE AQUÍ.
export const SPAWN    = { x: 0, z: 0 };
export const SAMPLE   = { x: 0, z: 0 };
export const HABITAT  = { x: 0, z: 0 };
export const ROUTE    = [/* waypoints {x,z} de SAMPLE a HABITAT */];
export const WALK_SPEED_MS = 1.0;          // velocidad a pie asumida para la telemetría
export const ROUTE_LENGTH_M = /* suma de tramos de ROUTE, calculada */ 0;
export const HABITAT_BEARING = 'north-east'; // rumbo textual desde SAMPLE, para las frases
```

### 3.3 Requisitos de la escena para VR (aviso al equipo de la escena)

`terrain.ts`, tal como está, **no funciona en VR**:
- `new PerspectiveCamera(38, 1, 10, …)`: el plano cercano está a **10 m**, así que no se ve el suelo a los pies. En VR tiene que estar en torno a 0,05 m.
- Solo dibuja en el evento `change` de `OrbitControls`. Necesita `renderer.xr.enabled = true` y `renderer.setAnimationLoop(...)`.
- El terreno sale exagerado 4× por defecto (`let factor = $state(4)` en `+page.svelte`). Para la vista en primera persona hay que usar 1×.
- Una muestra cada 16 m da triángulos enormes a escala humana. Es un tema estético que decide el equipo de la escena.

---

## 4. Pipeline de voz

### 4.1 Captura en el cliente (D21, D22)
- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` se llama **una sola vez**, dentro de `unlock()`. El stream queda abierto toda la sesión.
- Con cada `pttDown()` se crea un `MediaRecorder` sobre ese stream. El formato se comprueba con `MediaRecorder.isTypeSupported('audio/webm;codecs=opus')`.
- Con `pttUp()` se llama a `stop()` y **se espera al último `dataavailable`** antes de montar el Blob.
- Los clips de **menos de 600 ms se descartan** en el cliente: son toques accidentales.
- El audio se envía con `fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: blob })`. **Va como cuerpo binario, sin FormData**, así que no le afecta el chequeo CSRF de SvelteKit.

### 4.2 `POST /api/stt` → Groq Whisper
- El servidor monta el multipart hacia Groq con `filename: 'ptt.webm'`, modelo `whisper-large-v3-turbo` (o `whisper-large-v3`), `language: 'en'` y `prompt` con vocabulario: *"Jezero, Perseverance, MEDA, habitat, airlock, sample, dust storm, oxygen, suit power, visibility"*.
- **Filtro de transcripciones inventadas:** se devuelve `{ text: '' }` si el resultado está vacío, tiene menos de 2 palabras o coincide con las frases inventadas típicas de Whisper (*"Thank you for watching"*, *"you"*, *"Bye."*…).
- Si viene vacío, el cliente no llama al chat y Jarvis dice una frase fija: *"Say again, I didn't copy."* (mp3 pregrabado).
- Respuesta: `{ text }`.

### 4.3 `POST /api/chat` → Claude Haiku 5.5 (D7)
- Petición: `{ history: {role, content}[], text: string, telemetry: Telemetry }`. El cliente recorta el historial a los **últimos 6 turnos**.
- SDK oficial `@anthropic-ai/sdk`:
  - `model: 'claude-haiku-5-5'`
  - `output_config: { effort: 'low' }`, porque la latencia importa y la respuesta es corta.
  - `max_tokens: 2000`, con margen para que no se corte a mitad de frase.
  - `system`: el prompt fijo (personalidad + protocolo + instantánea MEDA) con `cache_control: { type: 'ephemeral' }`. **El prompt de sistema no cambia nunca a lo largo de la demo.** Todo lo que varía va en el mensaje del usuario.
  - Último mensaje del usuario: `"<telemetry>{json}</telemetry>\nAstronaut: {text}"`.
- `stop_reason === 'refusal'` o cualquier error → frase fija *"Comms are degraded. Follow the protocol: return to the habitat."* (mp3 pregrabado). Haiku 5.5 no tiene alternativa automática en el servidor.
- Errores del SDK: cadena de clases tipadas (`RateLimitError` → `APIError`), sin comparar mensajes de texto.
- Respuesta: `{ reply }`.

### 4.4 `POST /api/tts` → ElevenLabs (D24)
- Petición: `{ text }`. Respuesta: `audio/mpeg`.
- **Una voz predefinida fija** (`ELEVENLABS_VOICE_ID` en `.env`). No se usan voces de la Voice Library: puede que no estén disponibles por API en el plan gratuito.
- **Caché por `sha1(text)`** en memoria y en disco (`.cache/tts/`, en `.gitignore`), para que las tomas repetidas no gasten créditos.
- En desarrollo (`JARVIS_TTS=browser`) se usa `speechSynthesis` del navegador, sin gastar créditos. Con `JARVIS_TTS=elevenlabs` se usa ElevenLabs para grabar.
- Si ElevenLabs falla (cuota agotada o bloqueo), se pasa a `speechSynthesis`. **No está comprobado que funcione en Quest Browser.** Se detecta con `typeof window.speechSynthesis === 'object'` y se prueba en el nivel 2.
- Créditos del vídeo: «Voice: ElevenLabs».

### 4.5 Reproducción: cola única con interrupción (D20, D26)
- **Un único `AudioContext`**, creado y activado en `unlock()`, que reproduce un buffer de silencio para desbloquearse. Todo el audio (mp3 fijos y respuestas de voz) se decodifica y suena a través de él. No se usan `<audio>` sueltos.
- **Cola con prioridad:**
  - Las frases de evento (`storm_start`, etc.) tienen **prioridad alta**: cortan lo que suene y cancelan cualquier respuesta pendiente.
  - Las respuestas tienen prioridad normal.
  - Con `pttDown()`, **lo que esté sonando se corta**: el astronauta interrumpe a Jarvis.
  - Mientras hay una petición en curso (STT, chat o TTS), **se ignoran nuevas pulsaciones** y suena un *beep* corto de «ocupado».
- Cada petición lleva un `turnId`. Si llega una respuesta con un `turnId` antiguo (porque se canceló), se descarta.

### 4.6 Latencia esperada
Unos 2–4 s desde que se suelta A hasta que empieza a sonar Jarvis: STT ~0,5 s, Haiku ~1 s, TTS ~1 s. **Se tolera porque se puede cortar en edición** (D2). Para disimularla, al soltar A suena un *chirp* de «recibido».

---

## 5. Comportamiento de Jarvis

### 5.1 Personalidad (D16)
- Calmado, preciso y en inglés. Es un sistema de a bordo, no un amigo.
- **Dos frases como máximo** por respuesta.
- Siempre que pueda: **cita el paso del protocolo** en el que estáis y **una cifra de la telemetría**.
- **Nunca inventa cifras**: solo usa las de `<telemetry>` y las de la instantánea MEDA. Si no sabe algo, lo dice y redirige al protocolo.
- Si le preguntan algo que no tiene que ver con la misión, responde en una frase y vuelve al paso actual.

### 5.2 Protocolo de tormenta (D9, D29). BORRADOR, hay que validarlo
Es la **única fuente de verdad**: va en el prompt de sistema y de él salen los guiones de los mp3. Los peligros son **la visibilidad, la energía y el polvo, no la fuerza del viento**: con una presión de unos 6–7 hPa, el viento marciano no tiene fuerza física peligrosa, y un juez de la NASA lo notaría.

| Paso | Nombre | Instrucción |
|---|---|---|
| P1 | STOP & SECURE | Stop sampling. Seal the sample tube and stow it. |
| P2 | SUIT CHECK | Confirm helmet seal; switch on helmet lights and locator beacon. |
| P3 | POWER SAVE | Non-essential suit systems off — dust will cut solar recharge. |
| P4 | RETURN | Follow the marked route to the habitat, {HABITAT_BEARING}, {ROUTE_LENGTH_M} m. Stay on the route. |
| P5 | HOLD IF BLIND | If visibility drops below 20 m: stop, hold position, ping beacon, wait for guidance. Never cross the delta scarps blind. |
| P6 | AIRLOCK | Enter the airlock and dust off the suit before entering the habitat. |

**Paso actual (`protocolStep`):** lo lleva el cliente. Avanza por tiempo desde `storm_start` (P1 a los 0 s, P2 a los 15 s, P3 a los 30 s, P4 a los 45 s, P5 cuando visibilidad < 20 m, P6 cuando `distance ≤ 10 m`). En `/operator` las teclas 1–6 lo fuerzan a mano. Estos umbrales son una propuesta y se pueden ajustar al ritmo de la escena.

### 5.3 Telemetría simulada (D10)
El cliente la calcula en cada consulta. El reloj empieza en `mission_start` (t) y en `storm_start` (ts):

| Campo | Antes de la tormenta | Durante la tormenta |
|---|---|---|
| `o2_remaining_min` | 312 − t/60 | consumo ×1,5 (esfuerzo) |
| `suit_power_pct` | 64 − 0,01·t | −0,05 %/s (luces + calefacción, sin recarga solar) |
| `visibility_m` | 10 000 | decae exponencialmente hasta unos 15 m en unos 90 s |
| `distance_to_habitat_m` | `ROUTE_LENGTH_M` | baja a `WALK_SPEED_MS` desde que se entra en P4 |
| `air_temp_c`, `pressure_pa`, `wind_ms`, `dust_opacity` | instantánea MEDA (§6) | `dust_opacity` sube; el resto, valores de la instantánea |
| `phase`, `protocolStep` | `sampling` / — | `storm` / P1…P6 |

**Limitación conocida:** `distance_to_habitat_m` **no** sigue la posición real del jugador (D10, D27). Si en la escena el jugador no camina, Jarvis dirá que la distancia baja igualmente. Se puede corregir en edición o haciendo que la escena mueva al jugador por `ROUTE`.

### 5.4 Frases pregrabadas (`lines.ts` → `static/jarvis/*.mp3`)
Se usan en el **nivel 0** y como **avisos fijos** en los niveles 1 y 2. Los textos son **borradores**: las cifras `{…}` se rellenan desde `mission.ts` y la instantánea MEDA **antes** de generar los mp3.

| ID | Disparador | Texto (borrador) |
|---|---|---|
| L01 | `mission_start` | "Jarvis online. Sample site is ahead; surface temperature {air_temp_c} degrees, conditions nominal." |
| L02 | `sample_collected` | "Sample logged. Seal it and prepare to head back." |
| L03 | `storm_start` | "Warning: dust storm front approaching from the west. Protocol step one: stop sampling and secure the sample now." |
| L04 | `storm_start` + 30 s | "Visibility is dropping fast. Switch on your lights and beacon, and save suit power." |
| L05 | P5 | "Visibility under twenty metres. Hold position. I have your beacon." |
| L06 | P6 | "Airlock in range. Dust off before you enter. Well done." |
| E01 | STT vacío | "Say again, I didn't copy." |
| E02 | error del chat | "Comms are degraded. Follow the protocol: return to the habitat." |
| Q1–Q4 | solo nivel 0 (cue) | Respuestas a las preguntas del guion de §7.1 |

---

## 6. Datos: instantánea MEDA (D11)

- **Tiempo máximo: 1 h** buscando en el PDS (Mars 2020 MEDA). Si no aparece en ese tiempo, se usan rangos publicados para Jezero, **citando la fuente**.
- Mejor un sol **con polvo o viento**. **Ojo:** el red team cree, sin haberlo confirmado, que el sensor de viento de MEDA se dañó alrededor de la tormenta regional de enero de 2022. **Hay que comprobar qué sensores tienen datos** en el sol elegido. Si no hay viento, se omite `wind_ms` y no pasa nada, porque el viento no es el peligro (§5.2).
- Formato de `src/lib/data/meda-snapshot.json`:

```json
{
  "source": "NASA PDS — Mars 2020 MEDA, <product id>",
  "sol": 0,
  "utc_date": "YYYY-MM-DD",
  "local_time": "LMST hh:mm",
  "air_temp_c": { "value": 0, "min_sol": 0, "max_sol": 0 },
  "pressure_pa": 0,
  "relative_humidity_pct": null,
  "wind_ms": null,
  "dust_opacity": null,
  "notes": "qué sensores faltan / por qué se eligió este sol"
}
```

- La instantánea va en el prompt de sistema (es fija y se cachea) y como base de la telemetría.
- El terreno ya es real: es el DTM HiRISE `DTEEC_002387_1985_003798_1985_A01` que está en el repo.

---

## 7. Niveles de entrega (D13)

### 7.1 Nivel 0: guionizado (unas 2 h) · garantiza la demo
- `createAssistant({ mode: 'scripted' })`: no llama ni a STT ni al chat.
- Los mp3 L01–L06 y Q1–Q4 se generan **una vez** con `scripts/gen_lines.ts` y se guardan en el repo.
- **Canal del operador:** las Quest no tienen teclado, así que desde `/operator`, en el portátil, se mandan *cues* (`POST /api/cue {id}`). La página de las Quest consulta `GET /api/cue` cada 500 ms y reproduce el mp3 correspondiente. Los eventos de la escena (`storm_start`…) siguen disparando L03 automáticamente.
- El compañero lee un guion de preguntas, por ejemplo:
  - Q1 *"Jarvis, what do I do?"*
  - Q2 *"How far is the habitat?"*
  - Q3 *"How much oxygen do I have?"*
  - Q4 *"Is the wind going to knock me over?"*. La respuesta explica que no, por la baja presión, y que el peligro es la visibilidad. Es un buen guiño para los jueces.
- El operador lanza la respuesta Qn cuando el compañero termina de preguntar.

### 7.2 Nivel 1: en vivo en el portátil (unas 5 h)
- Pipeline completo (§4) desde `/operator`, **pulsando la barra espaciadora para hablar** con el micrófono del portátil.
- La telemetría se ve en directo en `/operator`, con un botón **Reset (R)** y las teclas 1–6 para el paso del protocolo.
- Esto es también el **plan B** (D5): si el micrófono de las Quest falla en el nivel 2, se graba con el nivel 1 en el portátil y el audio se junta en edición.

### 7.3 Nivel 2: en vivo en las Quest (unas 3 h)
- La escena integra el contrato de §3: `unlock()` en «Enter VR», A para hablar y los eventos.
- Acceso **por USB + `adb reverse`** (D19), véase §8.
- **Prueba de grabación nativa** (D17, D18): grabar 2 min con el grabador de las Quest mientras la web usa el micrófono y suena un mp3, y revisar que **se oyen las dos cosas**.

---

## 8. Despliegue y operación

### 8.1 Camino principal: USB + `adb reverse` (D19)
1. Activar el **modo desarrollador** en las Quest 2. Hace falta una cuenta de desarrollador de Meta y la app del móvil. **Hay que hacerlo pronto**, porque puede llevar 10–20 minutos.
2. `adb devices` para comprobar que las gafas aparecen. Luego `adb reverse tcp:5173 tcp:5173`.
3. En el portátil, `npm run dev`. En las Quest, abrir `http://localhost:5173`. **Localhost es un contexto seguro**, así que `getUserMedia` y WebXR funcionan sin HTTPS.
4. Depuración: `chrome://inspect` en el portátil, con las gafas conectadas por USB.
5. **Durante la grabación no se guarda ningún fichero**: una recarga en caliente expulsa de VR. Si hace falta, se arranca con `hmr: false` (variable `JARVIS_RECORDING=1` en `vite.config.ts`).

### 8.2 Reserva: Cloudflare quick tunnel (D14, sustituida por D19)
Ya configurada por si falla el USB:
- `vite.config.ts`: `server.allowedHosts: ['.trycloudflare.com']`.
- El audio ya va como cuerpo binario (§4.1), así que no le afecta el CSRF. El resto de endpoints usan JSON.
- Se activan el token y el límite de peticiones (§9).
- La URL cambia cada vez que se reinicia el túnel. Habrá que escribir la URL nueva, con el token, en las Quest.

### 8.3 Checklist antes de cada toma
- [ ] `JARVIS_TTS=elevenlabs` y créditos disponibles.
- [ ] Reset: `mission_start` o **R** en `/operator`.
- [ ] El móvil de respaldo está grabando audio (D18).
- [ ] El grabador nativo de las Quest tiene el micrófono activado.
- [ ] No hay ficheros sin guardar en el editor (para evitar recargas en caliente).

---

## 9. Seguridad

| Riesgo | Mitigación | Decisión |
|---|---|---|
| Claves en el cliente | Las claves solo están en `.env` (en `.gitignore`), se declaran en `src/env.ts` (`defineEnvVars`, SvelteKit 3), se leen con `$app/env/private` (módulo solo de servidor) y solo se usan en `+server.ts`. **Ninguna clave llega al navegador.** | D6 |
| Endpoint público que gasta créditos o agota cuotas | Con USB no hay endpoint público. Con túnel, `hooks.server.ts` exige `?k=<DEMO_TOKEN>` (o una cookie que se fija la primera vez) en `/api/*` y aplica un **límite en memoria de 10 peticiones por minuto**. Se pone un **tope de gasto de 5 $** en la consola de Anthropic y se **cierra el túnel** al terminar de grabar. | D15 |
| Audio de voz (datos personales) | **No se guarda audio en el servidor.** Va a Groq, se transcribe y se descarta. El historial solo está en la memoria del cliente. Se acepta que Groq y ElevenLabs procesan la voz y el texto del compañero según sus condiciones. | D16 |
| Inyección de instrucciones por voz | Riesgo bajo, porque es una demo controlada. El prompt de sistema prioriza el protocolo y Jarvis no ejecuta acciones, solo habla. | — |

**Ningún bloqueo de seguridad queda abierto.** Todos están mitigados o aceptados expresamente.

---

## 10. Casos límite

| Caso | Comportamiento |
|---|---|
| Toque accidental en A (< 600 ms) | Se descarta en el cliente sin hacer ninguna llamada. |
| Whisper devuelve silencio o una frase inventada | `{ text: '' }` → E01 «Say again». |
| A pulsado mientras Jarvis habla | Se corta la reproducción y empieza a grabar. |
| A pulsado mientras hay una petición en curso | Se ignora y suena el *beep* de ocupado. |
| `storm_start` llega durante una respuesta | L03 corta y cancela la respuesta pendiente. |
| Error de Claude o `refusal` | E02. |
| ElevenLabs falla | Se usa `speechSynthesis`. Si tampoco hay, el subtítulo muestra el texto. |
| Recarga en caliente en medio de una toma | Se repite la toma (es preventivo, véase §8.1). |
| Retoma sin reset | El historial y la telemetría arrastran la toma anterior. Por eso hay reset obligatorio en el checklist. |
| Varios clientes a la vez (portátil y Quest) | No comparten nada porque el servidor no guarda estado. Solo comparten `/api/cue`, que es global y está pensado así para el nivel 0. |
| Se agota la cuota gratuita de Groq | Improbable con este volumen (≈20 peticiones/min, ≈2.000/día). Si pasa, el operador vuelve a los cues del nivel 0. |

---

## 11. Estrategia de pruebas

No hay tiempo para una suite automatizada. Se prueba a mano con un checklist por nivel:

- **Nivel 0:** los cues desde `/operator` suenan en el portátil y en las Quest. L03 suena con `storm_start` sin pulsar nada (prueba del autoplay).
- **Nivel 1:** `curl` a `/api/chat` con una telemetría de ejemplo y una pregunta, para comprobar que la respuesta tiene 2 frases como máximo, cita el paso y no inventa cifras. Un viaje completo con la barra espaciadora. Un clip corto que se descarta. Una interrupción.
- **Nivel 2:**
  - El índice de A en `gamepad.buttons`.
  - Que el micrófono funciona dentro de VR.
  - Que no aparece el permiso del micrófono dentro de la sesión.
  - **Una grabación nativa de 2 minutos en la que se oyen la voz y Jarvis** (D18).
  - `speechSynthesis` disponible o no.

---

## 12. Riesgos aceptados y comprobaciones pendientes

| Riesgo | Estado |
|---|---|
| El grabador nativo de las Quest puede no capturar el micrófono mientras la web lo usa | **Aceptado** (D17). Se comprueba en el nivel 2 (D18) y hay un móvil de respaldo. Objeción registrada: si falla, obliga a repetir tomas al final del plazo. |
| No se ha encontrado documentación de `speechSynthesis` en Quest Browser | Se prueba en el nivel 2. Si no está, ElevenLabs es la única voz y el subtítulo hace de respaldo. |
| Límites de Groq y ElevenLabs sacados de fuentes de terceros | Hay que confirmarlos en sus consolas al crear las claves. |
| Datos del sensor de viento de MEDA | Comprobar en el sol elegido (§6). |
| Comportamiento del permiso de micrófono en Quest Browser | Mitigado pidiéndolo antes de entrar en VR (D21). Se comprueba en el nivel 2. |
| La distancia al hábitat no sigue la posición real del jugador | Limitación aceptada (D10, D27). Se corrige en edición o moviendo al jugador por `ROUTE`. |

---

## Decisions Log

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D1 | Alcance demo 1 | El juez hace una misión de recogida de sedimento en las Quest, empieza una tormenta, Jarvis da instrucciones por iniciativa propia y responde preguntas. Se graba y eso es la demo. Si falta tiempo, solo se renderiza el evento. | Es lo que define el usuario como entregable de la demo 1. | Interview | 2026-11-14 |
| D2 | Grabación | Un compañero lleva las gafas y se repite la toma las veces que haga falta. | Baja el listón de fiabilidad: la latencia y la red no son críticas porque se corta en edición. | Interview | 2026-11-14 |
| D3 | Plazo | Menos de 12 h hasta grabar. | Obliga a usar un pipeline mínimo, sin infraestructura propia, y a entregar por niveles. | Interview | 2026-11-14 |
| D4 | Escena | WebXR en Meta Quest Browser, ampliando el visor three.js actual. | Es lo que construye el equipo de la escena. Permite meter el asistente en la misma app. | Interview | 2026-11-14 |
| D5 | Integración | Módulo independiente dentro de la misma web, probado primero en el portátil y con eventos de JavaScript. Plan B: el portátil y el audio se juntan en edición. | Aísla tu parte del equipo de la escena y de los riesgos del Quest Browser. | Interview | 2026-11-14 |
| D6 | Pipeline de voz | Groq Whisper (gratis) → LLM → ElevenLabs (plan gratuito), todo a través de endpoints de SvelteKit. Las claves solo están en el servidor. Reserva de voz: `speechSynthesis`. Se descarta el reconocimiento de voz del navegador. | El usuario prefiere gratis. En los foros de Meta dicen que el reconocimiento de voz no funciona en Quest Browser. Las claves nunca llegan al cliente. | Interview | 2026-11-14 |
| D7 | LLM | Claude Haiku 5.5 (`claude-haiku-5-5`), pagando por uso. | Es rápido (en voz se nota) y casi gratis (0,10 $/0,50 $ por millón de tokens). Para instrucciones cortas basta. Lo eligió el usuario frente a Opus 5.5 y frente a un LLM gratuito en Groq. | Interview | 2026-11-14 |
| D8 | Turnos | Pulsar para hablar con un botón del mando. En el portátil, la barra espaciadora. | Evita el eco y los falsos disparos de la escucha continua con el micrófono pegado a los altavoces. El botón concreto se cerró en D25. | Interview | 2026-11-14 |
| D9 | Origen de las instrucciones | Protocolo fijo escrito por el equipo, aviso inicial en mp3 pregrabado, y Haiku responde ciñéndose al protocolo. | Las tomas son coherentes y Jarvis no inventa procedimientos. | Interview | 2026-11-14 |
| D10 | Estado de la misión | La escena solo emite `mission_start`, `sample_collected` y `storm_start`. El módulo simula la telemetría (O2, energía, visibilidad, distancia). | Reduce la dependencia con el equipo de la escena a un contrato de 3 eventos. | Interview | 2026-11-14 |
| D11 | Datos de clima | Instantánea JSON de un sol real de MEDA, citando la fuente. Como mucho 1 h de búsqueda; si no, rangos publicados. | Datos reales de cara a los jueces, con un tiempo acotado. | Interview | 2026-11-14 |
| D12 | Idioma | Jarvis habla inglés. | Pensado para la fase global y los jueces internacionales. La interfaz existente sigue en español. | Interview | 2026-11-14 |
| D13 | Orden de construcción | Nivel 0 guionizado → nivel 1 en vivo en el portátil → nivel 2 en vivo en las Quest. | Hay algo grabable en unas 2 h, y los mp3 del nivel 0 se reutilizan como avisos fijos. | Interview | 2026-11-14 |
| D14 | Despliegue (HTTPS) | `vite dev` + Cloudflare quick tunnel. **Sustituida por D19.** El túnel queda solo como reserva. | Era el camino inicial. El red team encontró que choca con el bloqueo de dominio de Vite, el CSRF y las recargas en caliente. | Interview | 2026-11-14 |
| D15 | Seguridad del endpoint | Token de demo en la URL, límite en memoria de unas 10 peticiones por minuto, tope de gasto de 5 $ en Anthropic y cerrar el túnel al terminar. | Bloqueo de seguridad: un endpoint público sin límite gasta créditos y cuotas. Con D19 solo aplica al túnel de reserva. | Interview | 2026-11-14 |
| D16 | Personalidad y retención | Jarvis calmado y preciso, dos frases como máximo, cita el paso del protocolo y una cifra de telemetría. No se guarda audio en el servidor y el historial solo vive en el cliente. | Valores por defecto propuestos y no corregidos por el usuario. Por voz, más de dos frases cansa. Minimiza los datos personales. | Interview | 2026-11-14 |
| D17 | Voz del astronauta en el vídeo | Se confía en el grabador nativo de las Quest (con el micrófono activado). | Decisión del usuario. **Objeción del entrevistador:** no está comprobado que capture el micrófono mientras la web lo usa. Se recomendaba audio aparte + subtítulos. Ambas posturas quedan registradas. | Red Team | 2026-11-14 |
| D18 | Comprobación de la grabación | Se comprueba al final, en el nivel 2. Si falla, se graba con un móvil de apoyo. | Decisión del usuario tras la pregunta de control. Riesgo aceptado: puede obligar a repetir tomas al final del plazo. | Red Team | 2026-11-14 |
| D19 | Acceso de las Quest | USB + `adb reverse tcp:5173 tcp:5173` → `http://localhost:5173`. El túnel queda como reserva (allowedHosts, cuerpo binario, `hmr` desactivado al grabar). | Localhost es un contexto seguro: sin bloqueo de dominio ni CSRF, y con depuración por `chrome://inspect`. Requiere el modo desarrollador. | Red Team | 2026-11-14 |
| D20 | Autoplay | Un único `AudioContext`, creado y activado en el clic de «Enter VR» (`assistant.unlock()`), que reproduce un silencio. Todo el audio pasa por él. | Si no, el aviso de tormenta, que se lanza sin gesto del usuario, puede bloquearse sin dar error. | Red Team | 2026-11-14 |
| D21 | Permiso del micrófono | `getUserMedia` se llama en el mismo clic de «Enter VR», antes de `requestSession`. Un solo stream persistente. Cada pulsación solo arranca y para MediaRecorder. | Evita el aviso de permiso dentro de VR y el retraso al arrancar, que cortaría la primera palabra. | Red Team | 2026-11-14 |
| D22 | Parámetros de Whisper | `ptt.webm` con el tipo comprobado. Los clips de menos de 600 ms se descartan. `language='en'` y un `prompt` con vocabulario. Las transcripciones vacías o inventadas se filtran en el servidor. | Evita que Haiku responda en cámara a preguntas que nadie ha hecho, y que el acento español o los nombres propios se transcriban mal. | Red Team | 2026-11-14 |
| D23 | Estado entre tomas | El servidor no guarda estado: el cliente tiene el historial (últimos 6 turnos) y la telemetría. `mission_start` o la tecla R lo ponen todo a cero. | Las retomas empiezan limpias y una recarga en caliente del servidor no borra nada a mitad de toma. | Red Team | 2026-11-14 |
| D24 | Ahorro en ElevenLabs | Una voz predefinida fija. Los mp3 fijos se generan una vez y se guardan en el repo. El texto a voz se cachea por hash. En desarrollo se usa `speechSynthesis`. Se acredita «Voice: ElevenLabs». | Protege los créditos gratuitos para el día de la grabación y cumple las condiciones del plan gratuito. | Red Team | 2026-11-14 |
| D25 | Botón para hablar | **A** en el mando derecho, consultado en cada fotograma (`pttDown`/`pttUp`). El gatillo queda reservado para recoger la muestra. | El gatillo choca con la interacción de la muestra. En WebXR, el gatillo y A se programan de forma distinta. | Red Team | 2026-11-14 |
| D26 | Eco y solapes | Una sola cola de audio. Pulsar A corta lo que suena. Las pulsaciones se ignoran mientras hay una petición en curso. Los avisos de evento tienen prioridad y cancelan la respuesta pendiente. `echoCancellation: true`. | Las Quest 2 tienen los altavoces abiertos junto al micrófono. Sin esto, Jarvis se transcribe a sí mismo. | Red Team | 2026-11-14 |
| D27 | Coherencia entre escena y Jarvis | `src/lib/mission.ts` compartido (spawn, muestra, hábitat, ruta, longitud y rumbo). La escena lo dibuja, la telemetría y los guiones de los mp3 usan las mismas cifras. | Evita que Jarvis hable de un hábitat que no se ve o de cifras que no coinciden con la escena. | Red Team | 2026-11-14 |
| D28 | Disparo en el nivel 0 | `/operator` en el portátil manda cues por `POST /api/cue`, y la página de las Quest los consulta cada 500 ms. | Las Quest no tienen teclado. El nivel 0 necesita un operador remoto. | Red Team | 2026-11-14 |
| D29 | Peligros del protocolo | El protocolo trata como peligros la visibilidad, la energía y el polvo, no la fuerza del viento. | Con la baja presión de Marte, el viento no es un peligro físico. Un juez de la NASA lo notaría. | Red Team | 2026-11-14 |

---

## Dependency Graph & Implementation Order

```
[0] Contrato + mission.ts (15 min) ──┬──▶ [1] Esqueleto del módulo + audio.ts (D20/D26) ──▶ [2] lines.ts + gen_lines.ts + mp3 ──▶ [3] /api/cue + /operator ══▶ ✅ NIVEL 0 grabable
   (con el equipo de la escena)      │
   [0b] Modo desarrollador Quest ────┼──────────────────────────────────────────────────────────────────────────────────────▶ [8]
   (en paralelo, 15 min)             │
                                     └──▶ [4] MEDA snapshot (≤1 h) ──▶ prompt.ts + protocol.ts ─┐
                                                                                                ▼
                   [5] /api/stt (Groq) ──▶ [6] /api/chat (Haiku) ──▶ [7] /api/tts (ElevenLabs + caché) + recorder.ts + telemetry.ts ══▶ ✅ NIVEL 1
                                                                                                │
                                                                                                ▼
                         [8] adb reverse + integración con la escena (unlock, A, eventos, subtítulos) ──▶ [9] pruebas en las gafas + grabación nativa ══▶ ✅ NIVEL 2
```

| Orden | Tarea | Depende de | Estimación | Nivel |
|---|---|---|---|---|
| 0 | Acordar el contrato de §3 con el equipo de la escena y rellenar `mission.ts` | — | 15 min | — |
| 0b | Activar el modo desarrollador en las Quest y comprobar `adb devices` (en paralelo) | — | 15 min | — |
| 1 | `npm ci`, crear `.env` (claves y voz), `createAssistant()`, `audio.ts` (AudioContext único y cola con prioridad), `unlock()` | 0 | 40 min | 0 |
| 2 | `lines.ts` con los textos L01–L06, E01–E02 y Q1–Q4 (cifras desde `mission.ts`), `scripts/gen_lines.ts` y generar los mp3 en `static/jarvis/` | 1 | 40 min | 0 |
| 3 | `/api/cue` + `/operator` (botones de cue y reset) + consulta periódica en la página | 2 | 40 min | 0 |
| — | **✅ Nivel 0 grabable (unas 2 h 15 min)** | 0–3 | | |
| 4 | Instantánea MEDA (≤1 h), `protocol.ts` y `prompt.ts`. Si las cifras de MEDA cambian, se regeneran L01 y otras | 0 | 1 h | 1 |
| 5 | `recorder.ts` (stream persistente, mínimo 600 ms, binario) + `/api/stt` (Groq, filtros) | 1 | 50 min | 1 |
| 6 | `telemetry.ts` (reloj, pasos del protocolo, reset) + `/api/chat` (Haiku, caché del prompt de sistema, gestión de `refusal`) | 4, 5 | 1 h 15 min | 1 |
| 7 | `/api/tts` (ElevenLabs, caché por hash, `JARVIS_TTS`) + barra espaciadora en `/operator` + subtítulos | 6 | 50 min | 1 |
| — | **✅ Nivel 1 (unas 4 h más)** | 4–7 | | |
| 8 | `adb reverse`, la escena integra `unlock()`, A (índice comprobado), eventos y subtítulos. `hmr` desactivado al grabar | 0b, 7 | 1 h 30 min | 2 |
| 9 | Pruebas en las gafas: micrófono en VR, `speechSynthesis`, **grabación nativa de 2 min con voz y Jarvis** (D18) | 8 | 45 min | 2 |
| — | **✅ Nivel 2 (unas 2 h 15 min más)** | 8–9 | | |
| (reserva) | Túnel: `allowedHosts`, `hooks.server.ts` (token y límite de peticiones), tope de 5 $ en la consola | 7 | 30 min | — |

**Total estimado: unas 8 h 30 min + 30 min de reserva**, dentro del margen de menos de 12 h, con unas 2–3 h para grabar e imprevistos.
