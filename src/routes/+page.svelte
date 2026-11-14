<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { asset } from '$app/paths';
	import { mountTerrain, type TerrainNotice } from '#lib/terrain.js';
	import { formatMarsTime, jezeroTime } from '#lib/mars-time.js';
	import './visor.css';
	import { BASE, ROVER } from '#lib/ares/route.js';
	import Ares01 from '#lib/ares/Ares01.svelte';
	import type { Ares01Dialogue, MissionSnapshot } from '#lib/ares/ares01.js';

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
	let clockVisible = $state(false);
	let editingClock = $state(false);
	let storm = $state(false);
	let mission = $state.raw<(MissionSnapshot & { time: number }) | undefined>();
	const sceneSol = $derived(mission ? Math.floor(localSol) + 14 / 24 : localSol);
	const clock = $derived(formatMarsTime(sceneSol));
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
	$effect(() => terrain?.setTime(sceneSol));
	$effect(() => terrain?.setDust(mission?.dust ?? Number(storm)));
	$effect(() => terrain?.setMissionView(mission && {
		point: mission.point,
		ahead: mission.ahead,
		route: mission.time >= 155 ? [ROVER, BASE] : mission.route,
		baseRoute: mission.time >= 155,
		showHazard: mission.time >= 90 && mission.time < 155,
		showPosition: mission.navigation !== 'Sin referencias',
		tilt: mission.time >= 108 && mission.time < 122 ? 1 : 0
	}));

	function playMissionDialogue(line: Ares01Dialogue) {
		window.dispatchEvent(new CustomEvent<Ares01Dialogue>('ares01:dialogue', { detail: line }));
	}

	async function clockShortcut(event: KeyboardEvent) {
		if (mission) return;
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

<svelte:window onkeydown={clockShortcut} />

<main class="visor">
	<canvas class="terrain" bind:this={canvas} tabindex="0"
		aria-label="Vista en primera persona del delta occidental de Jezero"
		aria-describedby="scene-input"></canvas>
	<p class="sr-only" id="scene-input">Haz clic en la escena o pulsa Intro para capturar el ratón.
		Usa WASD para caminar, las flechas para mirar y Escape para liberar el cursor.
		Pulsa H para mostrar el control del reloj marciano.</p>

	<div class="projected">
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

	<Ares01 ready={!!terrain} onview={(view) => { mission = view; }} ondialogue={playMissionDialogue} />

	{#if clockVisible && !mission}
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
