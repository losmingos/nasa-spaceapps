# ARES · Resumen

Visor 3D del delta de Jezero (Marte) con exploración libre, dos misiones interactivas, VR en Meta Quest 2 y un asistente de voz (SARA) que responde sobre telemetría simulada y datos reales de Mars 2020. Proyecto para el **NASA Space Apps Challenge (Madrid 2026)**.

Documentación completa: [`DOCUMENTATION.md`](DOCUMENTATION.md). Créditos de datos: [`RESOURCES.md`](RESOURCES.md). Arranque rápido: [`README.md`](README.md).

## Qué incluye

- **Exploración libre** sobre un DTM HiRISE real: caminar/conducir, minimapa, linterna, reloj marciano, clima MEDA, capas de relieve, peligro e infrarrojo simulado.
- **ARES-01 · The Last Sample**: perforar, recoger muestras y volver al rover bajo una tormenta de polvo creciente.
- **ARES-02 · Nightfall Protocol**: travesía nocturna, avería eléctrica, reparación exterior y entrega de un módulo en Bravo con presupuesto de energía.
- **SARA**: push-to-talk, STT, Claude con herramientas y TTS; acciones sobre mapa, infrarrojo, capa de peligro y linterna; modo guionizado de respaldo.
- **VR**: WebXR, menús por controladores, HUD estéreo y cabina del rover.
- **Vista compartida VR → PC**: Render 3D local en el PC con pose y estado por WebSocket (`/spectator`).
- **Panel de operador** (`/operator`) con canal de cues compartido para dirigir la demo.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Svelte 5 (runes) + SvelteKit 3 + Vite 8 + TypeScript 6 estricto |
| 3D | Three.js 0.187 sobre WebGL 2 |
| Voz | Groq Whisper `whisper-large-v3-turbo`, Anthropic `claude-haiku-5-5`, ElevenLabs `eleven_flash_v2_5` |
| Backend | Cloudflare Workers (`adapter-cloudflare`), Durable Objects `CueChannel` y `ShareRoom`, Cache API |
| Datos | HiRISE DTM + ortofoto, USGS SIM 3464, MEDA |
| Pruebas | `svelte-check` + build; recorridos manuales |

## Arquitectura en cinco ideas

1. El navegador hace el trabajo pesado (render, estado de misión, telemetría); el servidor solo valida y proxya IA, cues y caché.
2. Todas las páginas se prerenderizan; solo `/api/*` corre en el Worker.
3. Las claves de IA nunca llegan al cliente.
4. Los únicos estados compartidos son el canal de cues y las sesiones de la vista compartida, por eso viven en Durable Objects.
5. La voz es una cadena: PTT → `/api/stt` → `/api/chat` → `/api/tts` → Web Audio con barge-in.

## Rutas

| Ruta | Función |
|---|---|
| `/` | Exploración libre |
| `/missions/ares01` | Misión ARES-01 |
| `/missions/ares02` | Misión ARES-02 |
| `/vr-test` | Entrada recomendada en Quest |
| `/spectator` | Vista en directo del visor en el PC |
| `/operator` | Panel de operador (solo cliente) |
| `/api/stt`, `/api/chat`, `/api/tts` | Pipeline de SARA |
| `/api/cue` | Cues del operador |
| `/api/vr-share` | Salas de vista compartida |

Parámetros: `?tts=browser`, `?mode=scripted`, `?remote=1`, `?test=1`, `?k=<token>`.

## Misiones

- **ARES-01**: muestra a 70 m del rover, rodeo de +13 m, roca peligrosa de 6,4 m de radio y base a 2,4 km; acciones contextuales y diagnóstico del traje.
- **ARES-02**: batería útil de 9,5 kWh con reserva de 9,15 kWh; ruta planificada curva frente a ruta directa (la directa preserva la reserva); reparación exterior del módulo A y conducción degradada a 8 km/h.

## Datos y simulación

- **Terreno**: 434 × 722 nodos a 16,154 m (867 × 1443 a 8,08 m en alta calidad) con ortofoto HiRISE.
- **Clima**: curvas MEDA reales en bins de 10 min; tormenta mezclada con el sol 313; **no es tiempo real**.
- **Peligro**: pendiente 0,30 · suelo 0,20 · rocas 0,15 · relieve 0,10 · temperatura 0,15 · visibilidad 0,10. Avisos al **20 %** y **40 %**; rampa verde→ámbar en 0,33 y rojo en 0,575.
- **SWIR**: simulación monocroma a 1,65 µm, no una imagen espectral medida.

## Ejecutar

```sh
npm ci
npm run dev      # desarrollo
npm run check    # TypeScript + Svelte
npm run build    # build + prerender + Worker
npx wrangler deploy
```

Variables opcionales: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `DEMO_TOKEN`, `JARVIS_RECORDING`. Sin claves, la app arranca y los endpoints devuelven `503`.

## Seguridad

Token de demo (`?k=`, cabecera o cookie httpOnly), comparación en tiempo constante, rate limit de 10 peticiones/minuto en STT/chat/TTS y validación estricta de cuerpos y cues. Nada de secretos en el repositorio.

## Límites

SWIR, peligro, energía y oxígeno son simulaciones; MEDA es histórico; las posiciones de las lunas y el crepúsculo son aproximados; no hay suite de tests automatizada. `missions/vr-rehearsal/` es un nombre heredado para constantes compartidas. La vista compartida admite un espectador y se prueba en local con `npm run cf:dev`.
