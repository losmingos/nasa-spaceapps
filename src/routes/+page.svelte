<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import { mountTerrain, elevationColors } from '#lib/terrain.js';

	let canvas: HTMLCanvasElement;
	let terrain = $state<ReturnType<typeof mountTerrain>>();
	let error = $state('');
	let overhead = $state(false);
	let factor = $state(1);
	const source = 'https://www.uahirise.org/dtm/PSP_002387_1985';
	const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
	const format = (value: number) => number.format(value).replace('-', '−');

	onMount(() => {
		const request = new AbortController();
		async function load() {
			try {
				const response = await fetch(asset('terrain/jezero.bin'), { signal: request.signal });
				if (!response.ok) throw new Error('No se pudo descargar la cuadrícula HiRISE.');
				const data = await response.arrayBuffer();
				if (request.signal.aborted) return;
				terrain = mountTerrain(canvas, data);
				terrain.setExaggeration(factor);
			} catch (cause) {
				if (request.signal.aborted) return;
				console.error(cause);
				error = 'No se pudo abrir el terreno. Comprueba que tu navegador admite WebGL 2 y recarga la página.';
			}
		}
		void load();
		return () => {
			request.abort();
			terrain?.dispose();
		};
	});

	function selectView(top: boolean) {
		overhead = top;
		terrain?.view(top);
	}
</script>

<svelte:head>
	<title>Jezero | Explorador de terreno</title>
	<meta name="description" content="Explora en 3D el delta occidental del cráter Jezero a partir de datos HiRISE." />
</svelte:head>

<main>
	<header>
		<div class="identity"><span class="planet" aria-hidden="true">◉</span> JEZERO<span class="divider"></span><span class="subtle">EXPLORADOR DE TERRENO</span></div>
		<a href={source}>HiRISE ↗</a>
	</header>

	<section class="viewer" aria-labelledby="title">
		<div class="intro">
			<p class="coordinates">MARTE / 18,49° N · 77,41° E</p>
			<h1 id="title">Cráter Jezero</h1>
			<p class="subtitle">Delta occidental</p>
		</div>

		<div class="viewport">
			<canvas bind:this={canvas} tabindex="0" aria-label="Terreno 3D del delta occidental. Usa las flechas para desplazar la cámara." ></canvas>
			{#if error}
				<p class="message" role="alert">{error}</p>
			{:else if !terrain}
				<p class="message" role="status">Cargando terreno HiRISE…</p>
			{/if}
		</div>

		<div class="controls">
			<div class="view-buttons" role="group" aria-label="Vista inicial">
				<button disabled={!terrain} aria-pressed={!overhead} onclick={() => selectView(false)}>Órbita</button>
				<button disabled={!terrain} aria-pressed={overhead} onclick={() => selectView(true)}>Cenital</button>
				<button disabled={!terrain} onclick={() => selectView(overhead)} aria-label="Centrar vista" title="Centrar vista">⟲</button>
			</div>
			<label>
				<span>Escala vertical <strong>{factor}×</strong></span>
				<input type="range" min="1" max="8" step="1" bind:value={factor} disabled={!terrain}
					oninput={(event) => terrain?.setExaggeration(event.currentTarget.valueAsNumber)} />
			</label>
		</div>

		<footer>
			<p>Arrastra para girar · Desplaza con clic derecho · Acerca con la rueda o pellizca</p>
			{#if terrain}
				<div class="legend">
					<span>Elevación <span class="datum">· Marte 2000</span></span>
					<div class="ramp" style:background={`linear-gradient(90deg, ${elevationColors.join(',')})`}></div>
					<div class="limits"><span>{format(Math.round(terrain.low))} m</span><span>{format(Math.round(terrain.high))} m</span></div>
				</div>
			{/if}
		</footer>
	</section>

	<div class="metadata">
		<span>NASA / JPL-Caltech / Universidad de Arizona</span>
		{#if terrain}
			<span>{format(terrain.width / 1000)} × {format(terrain.length / 1000)} km de extensión · {format(terrain.spacing)} m entre muestras</span>
		{/if}
	</div>
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #100e0e; color: #f6eade; font-family: system-ui, sans-serif; }
	main { max-width: 1600px; margin: auto; padding: 0 clamp(16px, 4vw, 64px) 22px; }
	header { min-height: 66px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
	.identity, header a, .coordinates { font: 12px/1.4 ui-monospace, monospace; letter-spacing: 0.11em; }
	.identity { display: flex; align-items: center; gap: 12px; font-weight: 700; }
	.planet { color: #ed9d71; font-size: 20px; }
	.divider { height: 16px; width: 1px; background: #50392e; }
	.subtle { color: #bcaeaa; font-weight: 400; }
	header a { color: #f6bf98; text-underline-offset: 4px; white-space: nowrap; }
	.viewer { position: relative; isolation: isolate; display: flex; flex-direction: column; min-height: clamp(540px, 78svh, 940px); border: 1px solid #47352c; border-radius: 16px; overflow: hidden; background: radial-gradient(ellipse at 52% 58%, #35221a, #1b1513 61%, #151211); }
	.intro { padding: clamp(22px, 4vw, 52px); padding-bottom: 0; pointer-events: none; z-index: 1; }
	.coordinates { margin: 0 0 12px; color: #f3ab82; }
	h1 { font-family: Georgia, serif; font-size: clamp(40px, 6vw, 90px); font-weight: 400; letter-spacing: -0.055em; line-height: 0.96; margin: 0; }
	.subtitle { margin: 12px 0 0; color: #cdb7aa; font-size: clamp(14px, 2vw, 18px); }
	.viewport { position: absolute; inset: 38px 0 20px; }
	canvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
	canvas:active { cursor: grabbing; }
	canvas:focus-visible { outline: 2px solid #ffb689; outline-offset: -4px; }
	.message { position: absolute; top: 49%; inset-inline: 0; margin: auto; padding: 16px; max-width: 440px; text-align: center; pointer-events: none; }
	.controls { position: absolute; top: 28px; right: 28px; display: grid; gap: 10px; width: 194px; }
	.view-buttons, label { display: flex; border: 1px solid #67483a; background: #1d1715; border-radius: 8px; padding: 4px; gap: 4px; }
	button { flex: 1; font: inherit; font-size: 13px; border: 0; border-radius: 4px; padding: 8px; color: #f3dace; background: transparent; cursor: pointer; }
	button:last-child { flex: 0; }
	button:hover:not(:disabled), button[aria-pressed='true'] { background: #5d392b; color: #fff0df; }
	button:disabled { cursor: default; opacity: .55; }
	label { flex-direction: column; padding: 10px; font-size: 12px; }
	label span, .limits { display: flex; justify-content: space-between; gap: 8px; }
	input { width: 100%; margin: 0; accent-color: #ed9d71; }
	footer { margin-top: auto; display: flex; align-items: end; justify-content: space-between; gap: 12px; padding: 0 24px 20px; pointer-events: none; z-index: 1; }
	footer p, .metadata, .legend { color: #cbb8ac; font-size: 12px; }
	footer p { margin: 0; }
	.legend { width: 168px; flex-shrink: 0; }
	.datum { color: #b19a8c; }
	.ramp { height: 5px; margin: 6px 0; border-radius: 3px; }
	.limits { font: 11px ui-monospace, monospace; }
	.metadata { display: flex; flex-wrap: wrap; gap: 6px 24px; justify-content: space-between; margin-top: 14px; }
	@media (max-width: 650px) {
		.viewer { min-height: clamp(560px, 82svh, 860px); }
		.controls { left: 18px; right: auto; top: auto; bottom: 102px; }
		footer { padding: 0 16px 14px; align-items: end; }
		footer p { max-width: 140px; }
		.legend { width: 125px; }
		.viewport { inset: 88px 0 90px; }
		.subtle { font-size: 9px; }
	}
</style>
