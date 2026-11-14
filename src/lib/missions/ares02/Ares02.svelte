<script lang="ts">
	import { onMount, tick } from 'svelte';
	import MissionControls from '../MissionControls.svelte';
	import type { Point } from '../../visor/terrain.js';
	import { actions, act, startRun, stepRun, type Action, type Fault } from './interactive.js';
	import { labels, nightfallView, type NightfallView } from './visor.js';

	let { ready, onview, ondialogue, onstart, onpause, focusScene, getPosition, getHeading }: {
		ready: boolean;
		onview: (view?: NightfallView) => void;
		ondialogue: (view: NightfallView) => void;
		onstart: () => void;
		onpause: () => void;
		focusScene: () => void;
		getPosition: () => Point | undefined;
		getHeading: () => number | undefined;
	} = $props();

	let running = $state(false);
	let open = $state(false);
	let menuButton = $state<HTMLButtonElement>();
	let paused = $state(false);
	let run = $state.raw(startRun());
	let runId = $state(0);
	let testing = $state(false);
	let fast = $state(false);
	let heading = $state(0);
	let failure = $state<Fault>('none');
	let lastCue = '';
	const finished = $derived(run.stage === 'delivered' || run.stage === 'haven');
	const controls = $derived(running ? actions(run) : []);
	const snapshot = $derived(nightfallView(run, paused, runId, fast, heading));

	function start(next: boolean) {
		if (next && !ready) return;
		open = false;
		paused = false;
		running = next;
		run = startRun();
		runId++;
		fast = false;
		lastCue = '';
		onpause();
		if (document.pointerLockElement) document.exitPointerLock();
		if (next) onstart();
		if (next) void tick().then(focusScene);
	}

	function perform(action: Action) {
		if (paused || !running) return;
		const next = act(run, action);
		if (next === run) return;
		run = next;
		void tick().then(focusScene);
	}

	function togglePause() {
		paused = !paused;
		if (paused) {
			onpause();
			if (document.pointerLockElement) document.exitPointerLock();
		} else {
			lastCue = '';
			focusScene();
		}
	}

	function toggleTestSpeed() {
		fast = !fast;
		focusScene();
	}

	function keyboard(event: KeyboardEvent) {
		if (event.code === 'Escape' && open) {
			open = false;
			menuButton?.focus();
			return;
		}
		if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
			(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))) return;
		const code = event.code;
		if (!running) {
			if (code !== 'KeyI' || !ready) return;
			start(true);
		} else if (code === 'KeyP' && !finished) togglePause();
		else if (code === 'KeyR' && (paused || finished)) start(true);
		else if (code === 'KeyQ' && (paused || finished)) start(false);
		else if (code === 'KeyT' && testing && !finished) toggleTestSpeed();
		else {
			const index = ['KeyE', 'Digit1', 'Numpad1'].includes(code) ? 0
				: ['Digit2', 'Numpad2'].includes(code) ? 1 : -1;
			const action = controls[index];
			if (!action || paused) return;
			perform(action);
		}
		event.preventDefault();
	}

	onMount(() => {
		testing = new URLSearchParams(location.search).get('test') === '1';
		let previous = performance.now();
		const timer = setInterval(() => {
			const now = performance.now();
			const dt = Math.min((now - previous) / 1000, 0.25);
			previous = now;
			if (!running || paused || finished || document.hidden) return;
			heading = getHeading() ?? heading;
			run = stepRun(run, dt, getPosition() ?? run.position, failure);
		}, 100);
		return () => clearInterval(timer);
	});

	$effect(() => {
		onview(running ? snapshot : undefined);
		if (running && !paused && lastCue !== snapshot.key) {
			lastCue = snapshot.key;
			ondialogue(snapshot);
		}
	});
</script>

<svelte:window onkeydown={keyboard} />

<MissionControls id="nightfall-options" menuLabel="ARES-02" running={!!running} {open}
	onmenu={() => { open = !open; }} bind:menubutton={menuButton}
	actions={controls} actionLabels={labels} {paused} onact={perform}
	testing={testing && running && !finished} {fast} ontest={toggleTestSpeed}>
	{#if !running}
		<span>Nightfall Protocol · Simulación</span>
		<p>Entrega el módulo de reserva a Bravo. WASD conduce y camina · Flechas para mirar · E / 1 / 2 actúan · Espacio para hablar.</p>
		{#if testing}
			<label>Condición de prueba
				<select bind:value={failure}>
					<option value="none">Nominal</option>
					<option value="isolation">Diagnóstico no concluyente</option>
					<option value="energy">Consumo elevado</option>
				</select>
			</label>
		{/if}
		<div class="hud-actions">
			<button class="hud-action" disabled={!ready} onclick={() => start(true)}>Iniciar misión [I]</button>
		</div>
	{:else}
		{#if finished}<p>{snapshot.text}</p>{/if}
		<div class="hud-actions">
			{#if !finished}<button class="hud-action" onclick={togglePause}>{paused ? 'Reanudar' : 'Pausar'} [P]</button>{/if}
			<button class="hud-action" onclick={() => start(true)}>Reiniciar</button>
			<button class="hud-action" onclick={() => start(false)}>Salir</button>
		</div>
	{/if}
</MissionControls>
