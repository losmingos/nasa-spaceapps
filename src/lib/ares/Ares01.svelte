<script lang="ts">
	import { onMount } from 'svelte';
	import { dialogueAt, DURATION, missionAt, SOURCE, type Ares01Dialogue, type MissionSnapshot } from './ares01.js';

	let { ready, onview, ondialogue }: {
		ready: boolean;
		onview: (view?: MissionSnapshot & { time: number }) => void;
		ondialogue: (line: Ares01Dialogue) => void;
	} = $props();

	let mode = $state<'demo' | 'interactive'>();
	let time = $state(0);
	let paused = $state(false);
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
		onview({ ...snapshot, time });
		if (lastCue !== snapshot.cue.id) {
			lastCue = snapshot.cue.id;
			ondialogue(dialogueAt(time, snapshot));
		}
	});

	const clock = $derived(`${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`);
</script>

{#if !mode}
	<section class="mission launcher" aria-label="ARES-01">
		<div class="id">ARES-01 <span>· Simulación</span></div>
		<h1>The Last Sample</h1>
		<p>Una extracción geológica en el delta de Jezero. Demo de 3:30.</p>
		<div class="actions">
			<button class="primary" disabled={!ready} onclick={() => start('demo')}>Iniciar demo</button>
			<button disabled={!ready} onclick={() => start('interactive')}>Modo interactivo</button>
		</div>
	</section>
{:else}
	<section class="mission status" aria-label="Estado de ARES-01">
		<div class="id">ARES-01 <span>· {mode === 'demo' ? 'Demo' : 'Interactiva'}</span></div>
		<div class="clock"><time datetime={`PT${Math.floor(time)}S`}>{clock}</time> <span>/ 03:30</span></div>
		<progress value={time} max={DURATION} aria-label="Progreso de la demo"></progress>
		<div class="actions">
			{#if time < DURATION}
				<button onclick={() => { paused = !paused; }}>{paused ? 'Reanudar' : 'Pausar'}</button>
			{/if}
			<button onclick={() => start(mode)}>Reiniciar</button>
			<button onclick={() => start(undefined)}>Salir</button>
		</div>
	</section>

	{#if snapshot.sheltered}
		<div class="cabin" aria-hidden="true"><div></div></div>
	{/if}

	{#if snapshot.jump}
		<p class="jump" role="status">{snapshot.jump}</p>
	{/if}

	<section class="mission briefing" class:critical={snapshot.critical} class:warning={time >= 20 && time < 40}
		aria-label="Mensajes de misión">
		<div aria-live="polite" aria-atomic="true">
			<div class="id">{['trip', 'impact'].includes(snapshot.cue.id) ? 'EVA' : 'JARVIS'} <span>· {SOURCE}</span></div>
			<h2>{snapshot.cue.title}</h2>
			<p>{snapshot.cue.text}</p>
		</div>

		{#if time < 40 && choice !== 'return'}
			<p class="detail">Testigo de lutita · ≈13 × 60 mm · faltan 10 min</p>
		{/if}

		{#if time >= 20 && time < 65}
			<div class="trend" aria-label="Tendencia simulada del polvo: en aumento">
				<span>Polvo en aumento</span>
				<div class="trend-track"><i style:width={`${snapshot.dust * 100}%`}></i></div>
			</div>
		{/if}

		{#if time < 155}
			<dl>
				<div><dt>Energía del traje</dt><dd>76 %</dd></div>
				<div><dt>Posición</dt><dd>{snapshot.navigation}</dd></div>
				{#if !positionLost}<div><dt>Rover por ruta</dt><dd>{snapshot.remaining} m</dd></div>{/if}
				{#if time >= 113}<div><dt>Presión del traje</dt><dd>{snapshot.pressure}</dd></div>{/if}
			</dl>
		{/if}

		{#if positionLost}
			<button class="primary" onclick={() => { positionLost = false; testedPosition = true; }}>Solicitar relocalización</button>
		{:else if mode === 'interactive'}
			{#if time >= 20 && time < 40 && !choice}
				<div class="actions">
					<button class="primary" onclick={() => { choice = 'return'; }}>Volver al rover</button>
					<button onclick={() => { choice = 'continue'; }}>Continuar muestreo</button>
				</div>
			{:else if time >= 44 && time < 65 && !secured}
				<button class="primary" onclick={() => { secured = true; }}>Asegurar instrumental y guardar bitácora</button>
			{:else if time >= 93 && time < 100 && !rerouted}
				<div class="actions">
					<button class="primary" onclick={() => { rerouted = true; }}>Aceptar desvío (+65 m)</button>
					{#if !testedPosition}<button onclick={() => { positionLost = true; }}>Simular pérdida de posición</button>{/if}
				</div>
			{/if}
		{/if}

		{#if time >= DURATION}
			<dl class="report">
				<div><dt>Ciencia</dt><dd>Objetivo parcial · testigo pendiente</dd></div>
				{#if snapshot.log}
					<div><dt>Bitácora</dt><dd>{snapshot.log.site}. {snapshot.log.strata}. {snapshot.log.progress}.</dd></div>
				{/if}
				<div><dt>Seguridad</dt><dd>EVA cerrada en el rover. Regreso de 2,4 km a la base completado.</dd></div>
				<div><dt>Incertidumbre</dt><dd>Navegación y presión simuladas. Relieve HiRISE de 16,15 m; el obstáculo y el regolito son ficticios.</dd></div>
			</dl>
		{/if}
	</section>
{/if}

<style>
	.mission {
		position: absolute; z-index: 2;
		background: #151719f5; color: #eef8f5;
		border: 1px solid #53726a; border-radius: 8px;
		padding: 14px 16px;
		font-size: .875rem; line-height: 1.45;
	}
	.launcher, .status { top: 16px; left: 16px; max-width: calc(100% - 32px); }
	.launcher { width: 350px; }
	.status { min-width: 250px; }
	.id, .clock { font-family: 'IBM Plex Mono', ui-monospace, monospace; color: #a0ead6; }
	.id { font-weight: 700; letter-spacing: .05em; font-size: .78rem; }
	span, .detail, dt { color: #bfcfc9; }
	h1, h2, p { margin: 0; }
	h1 { margin-top: 4px; font-size: 1.55rem; line-height: 1.2; }
	h2 { margin: 5px 0; font-size: clamp(1.08rem, 3vw, 1.38rem); line-height: 1.2; }
	h1 + p, .detail { margin-top: 6px; }
	.actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
	button {
		border: 1px solid #769489; border-radius: 5px;
		background: #222d29; color: #eef8f5; font: inherit;
		min-height: 38px; padding: 5px 10px; cursor: pointer;
	}
	button:hover { background: #364c43; }
	button:focus-visible { outline: 2px solid #c0ffe5; outline-offset: 3px; }
	button:disabled { opacity: .55; cursor: wait; }
	.primary { background: #aadfcb; color: #15241e; }
	.primary:hover { background: #c3f5e1; }
	progress { display: block; width: 100%; height: 5px; accent-color: #aadfcb; }
	.briefing {
		bottom: 16px; left: 50%; transform: translateX(-50%);
		width: min(520px, calc(100% - 32px));
		max-height: calc(100% - 160px); overflow-y: auto;
	}
	.warning { border-color: #ffd18a; }
	.warning h2 { color: #ffd18a; }
	.critical { border-color: #ffa48e; }
	.critical h2 { color: #ffa48e; }
	dl { margin: 9px 0; display: flex; flex-wrap: wrap; gap: 5px 18px; }
	dt, .trend { font-size: .76rem; }
	dd { margin: 0; }
	.report { display: grid; }
	.trend { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
	.trend-track { flex: 1; height: 4px; background: #4a3a29; }
	.trend-track i { display: block; height: 100%; background: #f4b75d; }
	.jump { position: absolute; z-index: 1; top: 43%; width: 100%; text-align: center; color: #fff3df; background: #161411dc; padding: 9px; }
	.cabin { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
	.cabin div { position: absolute; inset: 14% 9% 18%; border: 12px solid #414e4f; border-radius: 18px 18px 52px 52px; box-shadow: 0 0 0 100vmax #101717e0; }
	@media (max-height: 420px) and (orientation: landscape) {
		.briefing { left: auto; right: 16px; transform: none; max-height: calc(100% - 32px); width: min(50vw, 520px); }
	}
</style>
