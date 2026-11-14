<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { asset } from '$app/paths';
	import { createAssistant, type Assistant, type AssistantState } from '#lib/jarvis/index.js';
	import { createMissionVoice } from '#lib/jarvis/mission-voice.js';
	import { STATUS_LABEL } from '#lib/jarvis/ui/shared.js';
	import { mountTerrain, type GeologyData, type TerrainDisplayMode, type TerrainNotice } from '#lib/terrain.js';
	import { formatMarsTime, jezeroTime } from '#lib/mars-time.js';
	import './visor.css';
	import { BASE, ROVER } from '#lib/ares/route.js';
	import Ares01 from '#lib/ares/Ares01.svelte';
	import type { interactiveSnapshot } from '#lib/ares/interactive.js';
	import { type Ares01Dialogue, type MissionSnapshot } from '#lib/ares/ares01.js';
	import type { VisorMessage } from '#lib/visor-optics.js';

	let canvas: HTMLCanvasElement;
	let map: HTMLCanvasElement;
	let messageText: HTMLSpanElement;
	let terrain = $state<ReturnType<typeof mountTerrain>>();
	let notice = $state<'loading' | 'error' | TerrainNotice>('loading');
	let noticeTimer: ReturnType<typeof setTimeout>;
	let exited = $state(false);
	let now = $state(Date.now());
	let selectedSol = $state<number>();
	const localSol = $derived(selectedSol ?? jezeroTime(now));
	const sol = $derived(Math.floor(localSol));
	let controlsVisible = $state(false);
	let storm = $state(false);
	let displayMode = $state<TerrainDisplayMode>('visible');
	let previousDisplayMode: TerrainDisplayMode = 'visible';
	let geologyAvailable = $state(false);
	let mission = $state.raw<(MissionSnapshot & {
		time: number;
		paused: boolean;
		player?: ReturnType<typeof interactiveSnapshot> & { run: number; enabled: boolean };
	})>();
	let missionVoice: ReturnType<typeof createMissionVoice> | undefined;
	let pendingMissionLine: string | undefined;
	function flushMissionLine() {
		if (voiceInput || !pendingMissionLine || (voice && !['idle', 'locked'].includes(voice.status))) return;
		const text = pendingMissionLine;
		pendingMissionLine = undefined;
		void missionVoice?.speak(text);
	}
	$effect(() => {
		assistant?.setMissionContext(mission ? JSON.stringify({
			scenario: 'ARES-01', state: mission.cue.state, objective: mission.cue.title,
			guidance: mission.cue.text, navigation: mission.navigation, pressure: mission.pressure,
			sample: mission.sample, logSaved: !!mission.log,
			target: mission.player?.heading,
			distanceToTargetM: mission.positionLost ? null : mission.player?.targetDistance,
			bearingDegrees: mission.positionLost ? null : mission.player?.compass,
			secondsElapsed: mission.time
		}) : undefined);
	});
	const sceneSol = $derived(mission ? Math.floor(localSol) + 14 / 24 : localSol);
	const clock = $derived(formatMarsTime(sceneSol));
	let assistant: Assistant | undefined;
	let voice = $state<AssistantState>();
	let unlocking = $state(false);
	let unlockFailed = $state(false);
	let voiceInput: 'pointer' | 'Space' | 'Enter' | undefined;
	const voiceStatus = $derived(voice?.status ?? 'locked');
	const micUnavailable = $derived(voice?.lastError?.startsWith('Microphone unavailable') ?? false);
	const voiceProblem = $derived(voiceStatus === 'locked' || voiceStatus === 'idle'
		? unlockFailed ? 'Audio no disponible' : micUnavailable ? 'Micrófono no disponible' : ''
		: '');
	const voiceLabel = $derived(unlocking ? 'Activando audio…' : voiceProblem ||
		(voiceStatus === 'locked' || voiceStatus === 'idle' ? '' : STATUS_LABEL[voiceStatus]));
	const missionTitles: Record<string, string> = {
		sample: 'Extrayendo testigo · ~10 min',
		advisory: 'Aumenta el polvo · vuelve al rover',
		abort: 'Aborta el muestreo · vuelve al rover',
		prepare: 'Asegura el equipo y guarda la bitácora',
		'early-return': 'Retorno preventivo',
		return: 'Sigue la ruta al rover',
		hazard: 'Detente · ladera inestable',
		reroute: 'Desvío seguro · +65 m',
		trip: 'Cuidado · pérdida de equilibrio',
		impact: 'Impacto en el traje · detente',
		'pressure-check': 'Comprobando presión del traje',
		'outer-damage': 'Posible daño exterior',
		'pressure-stable': 'Presión estable · continúa con cuidado',
		'position-lost': 'Detente · posición sin confirmar',
		shelter: 'Rover presurizado · EVA finalizada',
		'base-return': 'Regreso a la base · 2,4 km',
		closed: 'Base alcanzada · tripulación a salvo'
	};
	const hudMessage: VisorMessage = $derived(mission ? {
		title: missionTitles[mission.cue.id] ?? mission.cue.title,
		detail: mission.jump || (mission.player?.move && mission.player.heading ? `${mission.player.heading} · ${mission.player.targetDistance} m · ${mission.player.compass}°` : undefined) || (mission.cue.id === 'closed' ? 'Testigo pendiente · bitácora guardada'
			: mission.walking && !mission.positionLost ? `Rover · ${mission.remaining} m` : undefined),
		kind: mission.critical ? 'danger' : mission.time >= 20 && mission.time < 40 ? 'warning' : undefined
	} : {
		title: voiceLabel ? `JARVIS · ${voiceLabel}` : '',
		kind: voiceProblem && !unlocking ? 'danger' : undefined
	});
	const missionClock = $derived(mission ? `${Math.floor(mission.time / 60)}:${String(Math.floor(mission.time % 60)).padStart(2, '0')}` : '');
	$effect(() => {
		void voiceLabel;
		void clock;
		void sol;
		if (!mission) terrain?.refresh();
	});
	let controlsButton = $state<HTMLButtonElement>();
	const notices = {
		loading: { text: 'Cargando terreno', kind: 'info', label: 'Información' },
		ready: { text: '', kind: 'info', label: 'Información' },
		edge: { text: 'Paso bloqueado', kind: 'warning', label: 'Advertencia' },
		error: { text: 'Terreno no disponible', kind: 'danger', label: 'Peligro' }
	};
	const current = $derived(notices[notice]);
	$effect(() => {
		// Notices also redraw when the astronaut is stationary (rendering is demand-driven).
		void current.text;
		terrain?.refresh();
	});
	$effect(() => terrain?.setTime(sceneSol));
	$effect(() => terrain?.setDust(mission?.dust ?? Number(storm)));
	$effect(() => terrain?.setWind(voice?.telemetry.wind_ms ?? null));
	$effect(() => terrain?.setDisplayMode(displayMode));
	$effect(() => terrain?.setMissionView(mission && {
		point: mission.point,
		ahead: mission.ahead,
		route: mission.player?.route ?? (mission.time >= 155 ? [ROVER, BASE] : mission.route),
		baseRoute: mission.player?.baseRoute ?? mission.time >= 155,
		showHazard: mission.player?.showHazard ?? (mission.time >= 90 && mission.time < 155),
		showPosition: mission.navigation !== 'Sin referencias',
		tilt: mission.player?.tilt ?? (mission.time >= 108 && mission.time < 122 ? 1 : 0),
		player: mission.player
	}));

	function playMissionDialogue(line: Ares01Dialogue, interactive: boolean) {
		window.dispatchEvent(new CustomEvent<Ares01Dialogue>('ares01:dialogue', { detail: line }));
		if (interactive && line.speaker === 'jarvis') {
			pendingMissionLine = line.text;
			flushMissionLine();
		}
	}

	async function voiceDown(input: NonNullable<typeof voiceInput>) {
		const currentAssistant = assistant;
		if (voiceInput || unlocking || !currentAssistant) return;
		voiceInput = input;
		missionVoice?.stop();
		if (voiceStatus === 'locked' || micUnavailable) {
			unlocking = true;
			unlockFailed = false;
			try {
				await currentAssistant.unlock();
			} catch (cause) {
				console.error('[jarvis] Audio unavailable', cause);
				unlockFailed = true;
				return;
			} finally {
				unlocking = false;
			}
		}
		if (voiceInput === input && assistant === currentAssistant) currentAssistant.pttDown();
	}

	function voiceUp() {
		if (!voiceInput) return;
		voiceInput = undefined;
		assistant?.pttUp();
	}

	function onKeyDown(event: KeyboardEvent) {
		void clockShortcut(event);
		const target = event.target instanceof Element ? event.target : null;
		const onMic = !!target?.closest('.voice-control');
		const code = event.code;
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
			(code !== 'Space' && !(code === 'Enter' && onMic)) ||
			(!onMic && target?.closest('button, input, select, textarea, a, [contenteditable]'))) return;
		event.preventDefault();
		if (!event.repeat) void voiceDown(code);
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.code !== voiceInput) return;
		event.preventDefault();
		voiceUp();
	}

	async function clockShortcut(event: KeyboardEvent) {
		if (mission || event.defaultPrevented ||
			(event.code === 'Escape' && document.querySelector('.mission-controls [aria-expanded="true"]'))) return;
		if (event.code === 'Escape' && controlsVisible) {
			controlsVisible = false;
			canvas.focus();
			return;
		}
		if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
			(event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]'))) return;
		if (event.code === 'KeyI') {
			event.preventDefault();
			selectDisplayMode(displayMode === 'swir' ? previousDisplayMode : 'swir');
			return;
		}
		if (event.code !== 'KeyH') return;
		event.preventDefault();
		controlsVisible = !controlsVisible;
		if (controlsVisible) {
			if (document.pointerLockElement === canvas) document.exitPointerLock();
			await tick();
			if (controlsVisible) controlsButton?.focus();
		} else {
			canvas.focus();
		}
	}

	function selectDisplayMode(mode: TerrainDisplayMode) {
		if (mode !== 'swir') previousDisplayMode = mode;
		displayMode = mode;
	}

	function setClock(day: number, time: string) {
		if (!Number.isInteger(day) || day < 0 || day > 99999 || !time) return;
		const [hours, minutes] = time.split(':').map(Number);
		selectedSol = day + (hours * 60 + minutes) / 1440;
	}

	function showNotice(next: typeof notice) {
		clearTimeout(noticeTimer);
		if (next === notice || matchMedia('(prefers-reduced-motion: reduce)').matches) {
			exited = false;
			notice = next;
			return;
		}
		exited = true;
		const duration = parseFloat(getComputedStyle(messageText).getPropertyValue('--text-swap-dur')) || 200;
		noticeTimer = setTimeout(async () => {
			notice = next;
			exited = false;
			messageText.classList.add('is-enter-start');
			await tick();
			void messageText.offsetHeight;
			messageText.classList.remove('is-enter-start');
		}, duration);
	}

	onMount(() => {
		const request = new AbortController();
		const useBrowserVoice = new URLSearchParams(location.search).get('tts') === 'browser';
		missionVoice = createMissionVoice(useBrowserVoice);
		const jarvis = createAssistant({
			mode: 'live',
			tts: useBrowserVoice ? 'browser' : 'elevenlabs',
			cuePolling: false
		});
		assistant = jarvis;
		voice = jarvis.getState();
		const unsubscribeVoice = jarvis.onState((state) => { voice = state; flushMissionLine(); });
		now = Date.now();
		const clockTimer = setInterval(() => { now = Date.now(); }, 5000);
		async function load() {
			try {
				const response = await fetch(asset('terrain/jezero.bin'), { signal: request.signal });
				if (!response.ok) throw new Error('No se pudo descargar la cuadrícula HiRISE.');
				const data = await response.arrayBuffer();
				if (request.signal.aborted) return;
				let geology: GeologyData | undefined;
				try {
					const geologyResponse = await fetch(asset('terrain/jezero-geology.json'), { signal: request.signal });
					if (geologyResponse.ok) {
						const candidate = await geologyResponse.json() as GeologyData;
						if (Array.isArray(candidate.features)) geology = candidate;
					}
				} catch {
					// Terrain and DTM-derived slope remain available without the geology data.
				}
				if (request.signal.aborted) return;
				geologyAvailable = !!geology?.features.length;
				terrain = mountTerrain(canvas, map, data, asset('terrain/jezero-ortho.webp'), geology, showNotice,
					() => current.text,
					() => mission ? `ARES-01 · ${missionClock}${mission.paused ? ' · PAUSA' : ''}` : `SOL ${sol} · ${clock} LMST`,
					() => hudMessage,
					() => ({ active: displayMode === 'swir' }));
				showNotice('ready');
				if (matchMedia('(pointer: fine) and (min-width: 900px)').matches) {
					void terrain.loadHighQuality(asset('terrain/jezero-high.bin'), asset('terrain/jezero-ortho-high.webp'));
				}
			} catch (cause) {
				if (request.signal.aborted) return;
				console.error(cause);
				showNotice('error');
			}
		}
		void load();
		return () => {
			request.abort();
			assistant = undefined;
			unsubscribeVoice();
			jarvis.dispose();
			missionVoice?.dispose();
			clearInterval(clockTimer);
			clearTimeout(noticeTimer);
			terrain?.dispose();
			terrain = undefined;
		};
	});
</script>

<svelte:head>
	<title>Jezero | Visor de astronauta</title>
	<meta name="description" content="Recorre a pie el delta occidental de Jezero desde el visor de un astronauta." />
</svelte:head>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={voiceUp} />

<main class="visor">
	<canvas class="terrain" bind:this={canvas} tabindex="0"
		aria-label="Vista en primera persona del delta occidental de Jezero"
		aria-describedby="scene-input"></canvas>
	<p class="sr-only" id="scene-input">Haz clic en la escena o pulsa Intro para capturar el ratón.
		Usa WASD para caminar, las flechas para mirar y Escape para liberar el cursor.
		Pulsa H para abrir los controles y I para alternar SWIR; usa CAPA para elegir una vista.
		Mantén Espacio para hablar con Jarvis y suelta para enviar.</p>

	<div class="projected">
		<div class="sr-only" role="status" aria-atomic="true">
			{hudMessage.title}{#if mission?.jump} · {mission.jump}{/if}
		</div>
		{#if mission?.walking && !mission.positionLost}
			<p class="sr-only">Distancia al rover {mission.remaining} m</p>
		{/if}
		<div class="notice" class:sr-only={!current.text || !!terrain} data-kind={current.kind}>
			<span class="notice-mark" aria-hidden="true"></span>
			<span class="notice-words" role="status" aria-live="polite">
				<span class="t-text-swap" class:is-exit={exited} bind:this={messageText}>
					{#if current.text}<span class="sr-only">{current.label}. </span>{current.text}{/if}
				</span>
			</span>
		</div>

		{#if notice === 'error'}
			<p class="error-help">Comprueba que tu navegador admite WebGL 2 y recarga.</p>
		{/if}

		<div class="instruments sr-only" hidden={!terrain}>
			<figure class="radar">
				<div class="map-face" role="img" aria-label="Relieve local con la posición al centro y una flecha que indica el rumbo">
					<canvas bind:this={map} width="192" height="192" aria-hidden="true"></canvas>
				</div>
			</figure>

			<dl class="readouts" aria-label="Telemetría simulada">
				<dt class="sr-only">Oxígeno</dt>
				<dd>96<span>% O₂</span></dd>
				<dt class="sr-only">Temperatura</dt>
				<dd>−63<span>°C</span></dd>
			</dl>
			<p>Sol {sol}, {clock} hora solar media local de Jezero</p>
		</div>

		<div class="visor-controls">
			<Ares01 ready={!!terrain} onview={(view) => {
				mission = view;
			}} ondialogue={playMissionDialogue}
				onstart={() => { voiceInput = undefined; assistant?.reset(); missionVoice?.unlock(); }}
				onpause={() => { pendingMissionLine = undefined; missionVoice?.stop(); }}
				getPosition={() => terrain?.getPosition()}
				focusScene={() => canvas.focus()} />
			<button type="button" class="hud-action voice-control"
					aria-label="JARVIS. Mantén pulsado para hablar y suelta para enviar"
					aria-keyshortcuts="Space"
					data-recording={voiceStatus === 'recording'}
					onpointerdown={(event) => {
						if (event.button !== 0 || !event.isPrimary) return;
						event.currentTarget.setPointerCapture(event.pointerId);
						void voiceDown('pointer');
					}}
					onpointerup={() => { if (voiceInput === 'pointer') voiceUp(); }}
					onlostpointercapture={() => { if (voiceInput === 'pointer') voiceUp(); }}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
						stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<rect x="9" y="3" width="6" height="12" rx="3" />
						<path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6" />
					</svg>
					<span>JARVIS</span><kbd>Espacio</kbd><span class="touch-hint" aria-hidden="true">Mantén</span>
				</button>
		</div>
	</div>

	{#if !mission}
		<div class="scene-controls">
			<section id="scene-controls-panel" class="scene-controls-panel" aria-label="Controles de escena"
				hidden={!controlsVisible}>
					<div class="control-section">
						<h2>Hora marciana</h2>
						<label>Sol (MSD)
							<input type="number" min="0" max="99999" step="1" value={sol}
								onchange={(event) => setClock(event.currentTarget.valueAsNumber, clock)} />
						</label>
						<label>Hora local (LMST)
							<input type="time" value={clock}
								onchange={(event) => setClock(sol, event.currentTarget.value)} />
						</label>
						<button type="button" onclick={() => { now = Date.now(); selectedSol = undefined; }}>
							Hora actual
						</button>
					</div>
					<div class="control-section">
						<h2>Atmósfera</h2>
						<button type="button" aria-pressed={storm} onclick={() => { storm = !storm; }}>
							{storm ? 'Tormenta activa' : 'Modo tormenta'}
						</button>
					</div>
					<div class="control-section">
						<h2>CAPA</h2>
						<div class="layer-buttons" role="group" aria-label="Elegir una vista del terreno">
							<button type="button" aria-pressed={displayMode === 'visible'} onclick={() => selectDisplayMode('visible')}>Relieve</button>
							<button type="button" aria-pressed={displayMode === 'geology'} disabled={!geologyAvailable}
								onclick={() => selectDisplayMode('geology')}>Geología</button>
							<button type="button" aria-pressed={displayMode === 'slope'} onclick={() => selectDisplayMode('slope')}>Pendiente</button>
							<button type="button" aria-pressed={displayMode === 'swir'} aria-keyshortcuts="I"
								onclick={() => selectDisplayMode(displayMode === 'swir' ? previousDisplayMode : 'swir')}>SWIR sim. · I</button>
						</div>
						<p class="layer-caption">
							{#if displayMode === 'geology'}USGS SIM 3464 · registro regional ±100–200 m
							{:else if displayMode === 'slope'}DTM · verde &lt;5° · ámbar 5–12° · rojo &gt;12°
							{:else if displayMode === 'swir'}SIMULADO · 1.65 µm · polvo ×0.15
							{:else}Ortoimagen HiRISE + relieve{/if}
						</p>
					</div>
			</section>
			<button type="button" class="scene-controls-trigger" bind:this={controlsButton}
				aria-expanded={controlsVisible} aria-controls="scene-controls-panel" aria-keyshortcuts="H"
				onclick={() => { controlsVisible = !controlsVisible; }}>
				Controles <kbd>H</kbd>
			</button>
		</div>
	{/if}
</main>
