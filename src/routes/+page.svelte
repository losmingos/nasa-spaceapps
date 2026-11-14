<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { asset } from '$app/paths';
	import { createAssistant, type Assistant, type AssistantState } from '#lib/jarvis/index.js';
	import { createMissionVoice } from '#lib/jarvis/mission-voice.js';
	import { STATUS_LABEL } from '#lib/jarvis/ui/shared.js';
	import { mountTerrain, type TerrainNotice } from '#lib/visor/terrain.js';
	import { formatMarsTime, jezeroTime } from '#lib/visor/mars-time.js';
	import './visor.css';
	import Ares01 from '#lib/missions/ares01/Ares01.svelte';
	import type { Ares01Dialogue } from '#lib/missions/ares01/ares01.js';
	import { missionContext, missionMessage, missionModelUrls, missionTerrainView, type Ares01View } from '#lib/missions/ares01/visor.js';
	import type { VisorMessage } from '#lib/visor/optics.js';

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
	let mission = $state.raw<Ares01View>();
	let missionVoice: ReturnType<typeof createMissionVoice> | undefined;
	let pendingMissionLine: string | undefined;
	function flushMissionLine() {
		if (voiceInput || !pendingMissionLine || (voice && !['idle', 'locked'].includes(voice.status))) return;
		const text = pendingMissionLine;
		pendingMissionLine = undefined;
		void missionVoice?.speak(text);
	}
	$effect(() => {
		assistant?.setMissionContext(mission ? missionContext(mission) : undefined);
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
		? unlockFailed ? 'Audio unavailable' : micUnavailable ? 'Microphone unavailable' : ''
		: '');
	const voiceLabel = $derived(unlocking ? 'Enabling audio…' : voiceProblem ||
		(voiceStatus === 'locked' || voiceStatus === 'idle' ? '' : STATUS_LABEL[voiceStatus]));
	const hudMessage: VisorMessage = $derived(mission ? missionMessage(mission) : {
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
	let clockButton = $state<HTMLButtonElement>();
	let solInput = $state<HTMLInputElement>();
	const notices = {
		loading: { text: 'Loading terrain', kind: 'info', label: 'Information' },
		ready: { text: '', kind: 'info', label: 'Information' },
		edge: { text: 'Path blocked', kind: 'warning', label: 'Warning' },
		error: { text: 'Terrain unavailable', kind: 'danger', label: 'Danger' }
	};
	const current = $derived(notices[notice]);
	$effect(() => {
		// Notices also redraw when the astronaut is stationary (rendering is demand-driven).
		void current.text;
		terrain?.refresh();
	});
	$effect(() => terrain?.setTime(sceneSol));
	$effect(() => terrain?.setDust(mission?.dust ?? Number(storm)));
	$effect(() => terrain?.setMissionView(mission && missionTerrainView(mission)));

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
				if (!response.ok) throw new Error('Could not download the HiRISE elevation grid.');
				const data = await response.arrayBuffer();
				if (request.signal.aborted) return;
				terrain = mountTerrain(canvas, map, data, asset('terrain/jezero-ortho.webp'), showNotice,
					() => current.text,
					() => mission ? `ARES-01 · ${missionClock}${mission.paused ? ' · PAUSED' : ''}` : `SOL ${sol} · ${clock} LMST`,
					() => hudMessage, missionModelUrls());
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
			missionVoice?.dispose();
			clearInterval(clockTimer);
			clearTimeout(noticeTimer);
			terrain?.dispose();
		};
	});
</script>

<svelte:head>
	<title>Jezero | Astronaut visor</title>
	<meta name="description" content="Explore Jezero's western delta on foot through an astronaut visor." />
</svelte:head>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={voiceUp} />

<main class="visor">
	<canvas class="terrain" bind:this={canvas} tabindex="0"
		aria-label="First-person view of Jezero's western delta"
		aria-describedby="scene-input"></canvas>
	<p class="sr-only" id="scene-input">Click the scene or press Enter to capture the pointer.
		Use WASD to walk, the arrow keys to look, and Escape to release the pointer.
		Press H to show the Mars clock controls.
		Hold Space to talk to JARVIS and release to send.</p>

	<div class="projected">
		<div class="sr-only" role="status" aria-atomic="true">
			{hudMessage.title}{#if mission?.jump} · {mission.jump}{/if}
		</div>
		{#if mission?.walking && !mission.positionLost}
			<p class="sr-only">Distance to rover {mission.remaining} m</p>
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
			<p class="error-help">Check that your browser supports WebGL 2, then reload.</p>
		{/if}

		<div class="instruments sr-only" hidden={!terrain}>
			<figure class="radar">
				<div class="map-face" role="img" aria-label="Local terrain map with your position in the centre and an arrow showing your heading">
					<canvas bind:this={map} width="192" height="192" aria-hidden="true"></canvas>
				</div>
			</figure>

			<dl class="readouts" aria-label="Simulated telemetry">
				<dt class="sr-only">Oxygen</dt>
				<dd>96<span>% O₂</span></dd>
				<dt class="sr-only">Temperature</dt>
				<dd>−63<span>°C</span></dd>
			</dl>
			<p>Sol {sol}, {clock} Jezero local mean solar time</p>
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
					aria-label="JARVIS. Hold to talk and release to send"
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
					<span>JARVIS</span><kbd>Space</kbd><span class="touch-hint" aria-hidden="true">Hold</span>
				</button>
		</div>
	</div>

	{#if clockVisible && !mission}
		<div class="clock-controls">
			<button type="button" bind:this={clockButton} onclick={toggleEditor}
				aria-expanded={editingClock} aria-controls={editingClock ? 'clock-editor' : undefined}
				aria-keyshortcuts="H">Set time</button>
			<button type="button" aria-pressed={storm} onclick={() => { storm = !storm; }}>
				Storm mode
			</button>
			{#if editingClock}
				<div id="clock-editor" class="clock-editor">
					<label>Sol (MSD)
						<input type="number" min="0" max="99999" step="1" value={sol} bind:this={solInput}
							onchange={(event) => setClock(event.currentTarget.valueAsNumber, clock)} />
					</label>
					<label>Local time (LMST)
						<input type="time" value={clock}
							onchange={(event) => setClock(sol, event.currentTarget.value)} />
					</label>
					<button type="button" onclick={() => { now = Date.now(); selectedSol = undefined; }}>
						Return to current time
					</button>
				</div>
			{/if}
		</div>
	{/if}
</main>
