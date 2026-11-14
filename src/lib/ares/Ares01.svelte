<script lang="ts">
	import { onMount } from 'svelte';
	import { dialogueAt, DURATION, missionAt, type Ares01Dialogue, type MissionSnapshot } from './ares01.js';

	let { ready, onview, ondialogue }: {
		ready: boolean;
		onview: (view?: MissionSnapshot & { time: number; paused: boolean }) => void;
		ondialogue: (line: Ares01Dialogue) => void;
	} = $props();

	let mode = $state<'demo' | 'interactive'>();
	let time = $state(0);
	let paused = $state(false);
	let menuOpen = $state(false);
	let menuButton: HTMLButtonElement;
	let choice = $state<'continue' | 'return'>();
	let secured = $state(false);
	let rerouted = $state(false);
	let positionLost = $state(false);
	let testedPosition = $state(false);
	const snapshot = $derived(missionAt(time, choice, positionLost));
	const waiting = $derived(mode === 'interactive' && (
		(time === 25 && !choice) || (time === 48 && !secured) || (time === 96 && !rerouted)
	));
	let lastCue = '';

	function start(next: typeof mode) {
		time = 0;
		mode = next;
		paused = secured = rerouted = positionLost = testedPosition = false;
		choice = undefined;
		lastCue = '';
		if (document.pointerLockElement) document.exitPointerLock();
	}

	function advance(delta: number) {
		if (!mode || paused || waiting || positionLost) return;
		let next = Math.min(DURATION, time + delta);
		if (mode === 'demo' && time < 25 && next >= 25) choice = 'continue';
		if (mode === 'interactive') {
			if (!choice && time < 25) next = Math.min(next, 25);
			if (!secured && time < 48) next = Math.min(next, 48);
			if (!rerouted && time < 96) next = Math.min(next, 96);
		}
		time = next;
	}

	onMount(() => {
		let previous = performance.now();
		const timer = setInterval(() => {
			const now = performance.now();
			const delta = Math.min((now - previous) / 1000, 0.25);
			previous = now;
			if (!document.hidden) advance(delta);
		}, 100);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (!mode) {
			onview();
			return;
		}
		onview({ ...snapshot, time, paused });
		if (lastCue !== snapshot.cue.id) {
			lastCue = snapshot.cue.id;
			ondialogue(dialogueAt(time, snapshot));
		}
	});


	function begin(next: typeof mode) {
		menuOpen = false;
		start(next);
		menuButton.focus();
	}
</script>

<svelte:window onkeydown={(event) => {
	if (event.key !== 'Escape' || !menuOpen) return;
	event.preventDefault();
	menuOpen = false;
	menuButton.focus();
}} />

<section class="mission-controls" aria-label="ARES-01 · Simulación">
	{#if mode}
		{#if positionLost}
			<button class="hud-action" onclick={() => { positionLost = false; testedPosition = true; }}>Recuperar posición</button>
		{:else if mode === 'interactive'}
			{#if time >= 20 && time < 40 && !choice}
				<button class="hud-action" onclick={() => { choice = 'return'; }}>Volver al rover</button>
				<button class="hud-action" onclick={() => { choice = 'continue'; }}>Seguir muestreando</button>
			{:else if time >= 44 && time < 65 && !secured}
				<button class="hud-action" onclick={() => { secured = true; }}>Asegurar equipo y guardar bitácora</button>
			{:else if time >= 93 && time < 100 && !rerouted}
				<button class="hud-action" onclick={() => { rerouted = true; }}>Aceptar desvío</button>
				{#if !testedPosition}<button class="hud-action" onclick={() => { positionLost = true; }}>Simular fallo de posición</button>{/if}
			{/if}
		{/if}
	{/if}
	<button class="hud-action" bind:this={menuButton} aria-expanded={menuOpen} aria-controls="mission-options"
		onclick={() => { menuOpen = !menuOpen; }}>{mode ? 'Misión' : 'ARES-01'}</button>

	<div id="mission-options" class="mission-options t-panel-slide" data-open={menuOpen}
		inert={!menuOpen} aria-hidden={!menuOpen}>
		{#if !mode}
			<span>La última muestra · Simulación</span>
			<div class="hud-actions">
				<button class="hud-action" disabled={!ready} onclick={() => begin('interactive')}>Iniciar misión</button>
				<button class="hud-action" disabled={!ready} onclick={() => begin('demo')}>Ver demo · 3:30</button>
			</div>
		{:else if time >= DURATION}
			<p>Testigo pendiente. Regreso a la base completado.</p>
			{#if snapshot.log}<p>{snapshot.log.strata}. {snapshot.log.progress}.</p>{/if}
			<div class="hud-actions">
				<button class="hud-action" onclick={() => begin(mode)}>Reiniciar</button>
				<button class="hud-action" onclick={() => begin(undefined)}>Salir</button>
			</div>
		{:else}
			<div class="hud-actions">
				<button class="hud-action" onclick={() => { paused = !paused; }}>{paused ? 'Reanudar' : 'Pausar'}</button>
				<button class="hud-action" onclick={() => begin(mode)}>Reiniciar</button>
				<button class="hud-action" onclick={() => begin(undefined)}>Salir</button>
			</div>
		{/if}
	</div>
</section>
