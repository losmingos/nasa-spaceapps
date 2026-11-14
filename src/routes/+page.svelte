<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { asset } from '$app/paths';
	import { createAssistant, type Assistant, type AssistantState } from '#lib/jarvis/index.js';
	import { STATUS_LABEL } from '#lib/jarvis/ui/shared.js';
	import { mountTerrain, type TerrainNotice } from '#lib/terrain.js';
	import { formatMarsTime, jezeroTime } from '#lib/mars-time.js';
	import './visor.css';

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
	const clock = $derived(formatMarsTime(localSol));
	const sol = $derived(Math.floor(localSol));
	let clockVisible = $state(false);
	let editingClock = $state(false);
	let storm = $state(false);
	let assistant: Assistant | undefined;
	let voice = $state<AssistantState>();
	let unlocking = $state(false);
	let unlockFailed = $state(false);
	let spaceHeld = false;
	const voiceStatus = $derived(voice?.status ?? 'locked');
	const micUnavailable = $derived(voice?.lastError?.startsWith('Microphone unavailable') ?? false);
	const voiceProblem = $derived(voiceStatus === 'locked' || voiceStatus === 'idle'
		? unlockFailed ? 'Audio no disponible' : micUnavailable ? 'Micrófono no disponible' : ''
		: '');
	const voiceLabel = $derived(unlocking ? 'Activando audio…' : voiceProblem ||
		(voiceStatus === 'locked' ? 'Activa el micrófono' :
			voiceStatus === 'idle' ? 'Mantén para hablar' : STATUS_LABEL[voiceStatus]));
	let clockButton = $state<HTMLButtonElement>();
	let solInput = $state<HTMLInputElement>();
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
	$effect(() => terrain?.setTime(localSol));
	$effect(() => terrain?.setStorm(storm));

	async function voiceDown(event: KeyboardEvent) {
		if (event.code !== 'Space' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
			(event.target instanceof Element &&
				event.target.closest('button, input, select, textarea, a, [contenteditable]'))) return;
		event.preventDefault();
		const currentAssistant = assistant;
		if (event.repeat || spaceHeld || unlocking || !currentAssistant) return;
		spaceHeld = true;
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
		if (spaceHeld && assistant === currentAssistant) currentAssistant.pttDown();
	}

	function voiceUp() {
		if (!spaceHeld) return;
		spaceHeld = false;
		assistant?.pttUp();
	}

	function onKeyDown(event: KeyboardEvent) {
		void voiceDown(event);
		void clockShortcut(event);
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.code !== 'Space' || !spaceHeld) return;
		event.preventDefault();
		voiceUp();
	}

	async function clockShortcut(event: KeyboardEvent) {
		if (event.code === 'Escape' && clockVisible) {
			clockVisible = editingClock = false;
			canvas.focus();
			return;
		}
		if (event.code !== 'KeyH' || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
			(event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]'))) return;
		event.preventDefault();
		clockVisible = !clockVisible;
		if (clockVisible) {
			if (document.pointerLockElement === canvas) document.exitPointerLock();
			await tick();
			if (clockVisible) clockButton?.focus();
		} else {
			editingClock = false;
			canvas.focus();
		}
	}

	async function toggleEditor() {
		editingClock = !editingClock;
		if (editingClock) {
			await tick();
			if (editingClock) solInput?.focus();
		}
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
		const jarvis = createAssistant({
			mode: 'live',
			tts: new URLSearchParams(location.search).get('tts') === 'browser' ? 'browser' : 'elevenlabs',
			cuePolling: false
		});
		assistant = jarvis;
		voice = jarvis.getState();
		const unsubscribeVoice = jarvis.onState((state) => { voice = state; });
		now = Date.now();
		const clockTimer = setInterval(() => { now = Date.now(); }, 5000);
		async function load() {
			try {
				const response = await fetch(asset('terrain/jezero.bin'), { signal: request.signal });
				if (!response.ok) throw new Error('No se pudo descargar la cuadrícula HiRISE.');
				const data = await response.arrayBuffer();
				if (request.signal.aborted) return;
				terrain = mountTerrain(canvas, map, data, asset('terrain/jezero-ortho.webp'), showNotice,
					() => current.text, () => `SOL ${sol} · ${clock} LMST`);
				showNotice('ready');
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
			clearInterval(clockTimer);
			clearTimeout(noticeTimer);
			terrain?.dispose();
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
		Pulsa H para mostrar el control del reloj marciano.
		Mantén Espacio para hablar con Jarvis y suelta para enviar.</p>

	<div class="projected">
		<div class="jarvis-status" data-status={voiceProblem && !unlocking ? 'error' : voiceStatus}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
				stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				{#if unlocking || voiceStatus === 'thinking'}
					<path d="M4 12h1m6.5 0h1m6.5 0h1" stroke-width="3" />
				{:else if voiceProblem}
					<path d="M12 4v10m0 5h.01" />
				{:else if voiceStatus === 'speaking'}
					<path d="M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4" />
				{:else}
					<rect x="9" y="3" width="6" height="12" rx="3" />
					<path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6" />
				{/if}
			</svg>
			<span role="status"><strong>Jarvis</strong> · {voiceLabel}</span>
			{#if !unlocking && (voiceStatus === 'locked' || voiceStatus === 'idle')}
				<kbd>Espacio</kbd>
			{/if}
		</div>
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
	</div>

	{#if clockVisible}
		<div class="clock-controls">
			<button type="button" bind:this={clockButton} onclick={toggleEditor}
				aria-expanded={editingClock} aria-controls={editingClock ? 'clock-editor' : undefined}
				aria-keyshortcuts="H">Cambiar hora</button>
			<button type="button" aria-pressed={storm} onclick={() => { storm = !storm; }}>
				Modo tormenta
			</button>
			{#if editingClock}
				<div id="clock-editor" class="clock-editor">
					<label>Sol (MSD)
						<input type="number" min="0" max="99999" step="1" value={sol} bind:this={solInput}
							onchange={(event) => setClock(event.currentTarget.valueAsNumber, clock)} />
					</label>
					<label>Hora local (LMST)
						<input type="time" value={clock}
							onchange={(event) => setClock(sol, event.currentTarget.value)} />
					</label>
					<button type="button" onclick={() => { now = Date.now(); selectedSol = undefined; }}>
						Volver a la hora actual
					</button>
				</div>
			{/if}
		</div>
	{/if}
</main>
