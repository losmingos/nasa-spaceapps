<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { asset } from '$app/paths';
	import { mountTerrain, type TerrainNotice } from '#lib/terrain.js';
	import './visor.css';

	let canvas: HTMLCanvasElement;
	let map: HTMLCanvasElement;
	let messageText: HTMLSpanElement;
	let terrain = $state<ReturnType<typeof mountTerrain>>();
	let notice = $state<'loading' | 'error' | TerrainNotice>('loading');
	let noticeTimer: ReturnType<typeof setTimeout>;
	let exited = $state(false);
	const notices = {
		loading: { text: 'Cargando terreno', kind: 'info', label: 'Información' },
		ready: { text: '', kind: 'info', label: 'Información' },
		edge: { text: 'Paso bloqueado', kind: 'warning', label: 'Advertencia' },
		error: { text: 'Terreno no disponible', kind: 'danger', label: 'Peligro' }
	};
	const current = $derived(notices[notice]);

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
		async function load() {
			try {
				const response = await fetch(asset('terrain/jezero.bin'), { signal: request.signal });
				if (!response.ok) throw new Error('No se pudo descargar la cuadrícula HiRISE.');
				const data = await response.arrayBuffer();
				if (request.signal.aborted) return;
				terrain = mountTerrain(canvas, map, data, showNotice);
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
			clearTimeout(noticeTimer);
			terrain?.dispose();
		};
	});
</script>

<svelte:head>
	<title>Jezero | Visor de astronauta</title>
	<meta name="description" content="Recorre a pie el delta occidental de Jezero desde el visor de un astronauta." />
</svelte:head>

<main class="visor">
	<canvas class="terrain" bind:this={canvas} tabindex="0"
		aria-label="Vista en primera persona del delta occidental de Jezero"
		aria-describedby="scene-input"></canvas>
	<p class="sr-only" id="scene-input">Haz clic en la escena o pulsa Intro para capturar el ratón.
		Usa WASD para caminar, las flechas para mirar y Escape para liberar el cursor.</p>

	<div class="projected">
		<div class="notice" class:sr-only={!current.text} data-kind={current.kind}>
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

		<div class="instruments" hidden={!terrain}>
			<figure class="radar">
				<figcaption><span>Mapa local</span><span aria-label="Norte">N</span></figcaption>
				<div class="map-face" role="img" aria-label="Relieve local con la posición al centro y una flecha que indica el rumbo">
					<canvas bind:this={map} width="192" height="192" aria-hidden="true"></canvas>
				</div>
				<span class="map-scale">160 m</span>
			</figure>

			<dl class="readouts" aria-label="Telemetría simulada">
				<div><dt>Oxígeno</dt><dd>96<span>%</span></dd></div>
				<div><dt>Temperatura</dt><dd>−63<span>°C</span></dd></div>
			</dl>
		</div>
	</div>

</main>
