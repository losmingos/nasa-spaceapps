<script lang="ts">
	import { onMount } from 'svelte';
	import { asset, resolve } from '$app/paths';
	import { createSpectator } from '#lib/visor/share-client.js';
	import { CODE_PATTERN, displayCode, normalizeCode, type ShareHud, type SharePose, type ShareWorld } from '#lib/visor/share-protocol.js';
	import { mountTerrain, type GeologyData } from '#lib/visor/terrain.js';
	import { createMissionScene } from '#lib/missions/ares01/visor.js';
	import { createNightfallScene } from '#lib/missions/ares02/scene.js';
	import { STATUS_LABEL } from '#lib/jarvis/ui/shared.js';

	let code = $state('');
	let status = $state('');
	let active = $state(false);
	let playing = $state(false);
	let hud = $state.raw<ShareHud>();
	let canvas: HTMLCanvasElement;
	let map: HTMLCanvasElement;
	let session: ReturnType<typeof createSpectator> | undefined;
	let terrain: ReturnType<typeof mountTerrain> | undefined;
	let loadRequest: AbortController | undefined;
	let latestWorld: ShareWorld | undefined;
	let appliedWorld: ShareWorld | undefined;
	let missionViewKey: string | undefined;
	let latestPose: SharePose | undefined;

	function disconnect() {
		session?.close();
		session = undefined;
		loadRequest?.abort();
		loadRequest = undefined;
		terrain?.dispose();
		terrain = undefined;
		latestWorld = appliedWorld = undefined;
		missionViewKey = undefined;
		latestPose = undefined;
		hud = undefined;
		active = playing = false;
	}

	function applyWorld(world: ShareWorld) {
		latestWorld = world;
		if (!terrain) return;
		if (world.mission && world.mission !== appliedWorld?.mission) {
			terrain.loadMissionScene(world.mission === 'ares02' ? createNightfallScene : createMissionScene);
		}
		const viewKey = JSON.stringify(world.view);
		if (viewKey !== missionViewKey) {
			terrain.setMissionView(world.view);
			missionViewKey = viewKey;
		}
		if (world.sol !== appliedWorld?.sol) terrain.setTime(world.sol);
		if (world.dust !== appliedWorld?.dust) terrain.setDust(world.dust);
		if (world.wind !== appliedWorld?.wind) terrain.setWind(world.wind);
		if (world.display !== appliedWorld?.display) terrain.setDisplayMode(world.display);
		if (world.flashlight !== appliedWorld?.flashlight) terrain.setFlashlight(world.flashlight);
		if (world.mapZoom !== appliedWorld?.mapZoom) terrain.setMapZoom(world.mapZoom);
		appliedWorld = world;
	}

	function applyPose(pose: SharePose) {
		latestPose = pose;
		if (!terrain) return;
		terrain.setSpectatorPose(pose);
		if (!playing) {
			playing = true;
			status = 'En directo';
		}
	}

	async function loadTerrain(signal: AbortSignal) {
		try {
			const [grid, geology] = await Promise.all([
				fetch(asset('terrain/jezero.bin'), { signal }).then((res) => {
					if (!res.ok) throw new Error('No se pudo cargar el terreno.');
					return res.arrayBuffer();
				}),
				fetch(asset('terrain/jezero-geology.json'), { signal })
					.then(async (res) => res.ok ? await res.json() as GeologyData : undefined)
					.catch(() => undefined)
			]);
			if (signal.aborted) return;
			terrain = mountTerrain(canvas, map, grid, asset('terrain/jezero-ortho.webp'),
				Array.isArray(geology?.features) ? geology : undefined,
				() => {}, () => hud?.notice ?? '', () => hud?.clock ?? '',
				() => hud?.message ?? { title: '' },
				() => ({ active: latestWorld?.display === 'swir' }),
				() => hud?.readings ?? { o2Percent: 96, airTempC: null },
				() => {}, undefined, true);
			if (latestWorld) applyWorld(latestWorld);
			if (latestPose) applyPose(latestPose);
		} catch {
			if (signal.aborted) return;
			disconnect();
			status = 'El PC no pudo cargar el terreno 3D. Comprueba que el navegador admita WebGL 2.';
		}
	}

	function connect(event: SubmitEvent) {
		event.preventDefault();
		const normalized = normalizeCode(code);
		if (!CODE_PATTERN.test(normalized)) {
			status = 'Introduce los 8 caracteres que aparecen en las gafas.';
			return;
		}
		disconnect();
		code = displayCode(normalized);
		active = true;
		loadRequest = new AbortController();
		void loadTerrain(loadRequest.signal);
		session = createSpectator(normalized, (state) => {
			if (state.type === 'world') applyWorld(state);
			else {
				hud = state;
				terrain?.refresh();
			}
		}, applyPose, (message, room) => {
			if (!room) disconnect();
			status = message;
		});
		void session.start();
	}

	onMount(() => {
		code = new URLSearchParams(location.search).get('code')?.slice(0, 14) ?? '';
		addEventListener('pagehide', disconnect);
		return () => {
			removeEventListener('pagehide', disconnect);
			disconnect();
		};
	});
</script>

<svelte:head>
	<title>Vista en directo | ARES</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<header>
		<a href={resolve('/')}>◉ ARES / VR</a>
		<h1>Vista en directo</h1>
		<p>Introduce el código de las gafas para ver su vista en este PC.</p>
	</header>

	<form onsubmit={connect}>
		<label for="room-code">Código de conexión</label>
		<div class="row">
			<input id="room-code" bind:value={code} placeholder="XXXX-XXXX" autocomplete="off"
				autocapitalize="characters" spellcheck={false} maxlength="14" disabled={active} required />
			{#if active}
				<button type="button" onclick={() => { disconnect(); status = 'Te has desconectado.'; }}>Desconectar</button>
			{:else}
				<button type="submit">Conectar</button>
			{/if}
		</div>
	</form>
	<p class="status" role="status">{playing ? '● ' : ''}{status}</p>
	<div class="screen" hidden={!active}>
		<canvas class="scene" bind:this={canvas} aria-label="Vista 3D en primera persona de las gafas"></canvas>
		<canvas bind:this={map} width="192" height="192" hidden></canvas>
		{#if hud?.menu}
			<section class="menu" aria-label="Menú abierto en las gafas">
				<h2>{hud.menu.title}</h2>
				{#each hud.menu.lines ?? [] as line}<p>{line}</p>{/each}
				<ul>
					{#each hud.menu.items as item (item.id)}
						<li class:current={item.active} class:disabled={item.disabled}>{item.label}</li>
					{/each}
				</ul>
				{#if hud.menu.hint}<p>{hud.menu.hint}</p>{/if}
			</section>
		{:else if hud?.controls}
			<div class="controls">
				{#each hud.controls.actions as action (action.hand)}
					<span>{action.label}</span>
				{/each}
				{#if hud.controls.voice && hud.controls.voice !== 'idle'}
					<span>SARA · {hud.controls.voice === 'unavailable' ? 'No disponible' : STATUS_LABEL[hud.controls.voice]}</span>
				{/if}
			</div>
		{/if}
		{#if hud?.subtitle}<p class="subtitle">SARA · {hud.subtitle}</p>{/if}
	</div>
</main>

<style>
	:global(body) { margin: 0; background: #100e0e; color: #f6eade; font: 16px system-ui, sans-serif; }
	main { box-sizing: border-box; max-width: 1100px; margin: auto; padding: clamp(20px, 4vw, 48px); }
	a { color: #f6bf98; font: 700 13px ui-monospace, monospace; letter-spacing: .12em; }
	h1 { margin: 14px 0 0; font: 400 clamp(34px, 5vw, 54px) Georgia, serif; }
	p { color: #d9c2b4; }
	label { display: block; margin-bottom: 6px; }
	.row { display: flex; gap: 8px; flex-wrap: wrap; }
	input, button { box-sizing: border-box; border: 1px solid #91664f; border-radius: 8px; color: inherit; padding: 10px 14px; font: inherit; }
	input { width: 12ch; background: #1d1715; font-family: ui-monospace, monospace; text-transform: uppercase; }
	button { background: #5d392b; cursor: pointer; }
	.status { min-height: 1.4em; }
	.screen { position: relative; border: 1px solid #47352c; border-radius: 10px; overflow: hidden; background: #090808; }
	.scene { display: block; width: 100%; height: clamp(240px, 62vw, 70vh); pointer-events: none; }
	.menu { position: absolute; inset: 10% 12%; overflow: auto; padding: clamp(12px, 4vw, 32px); background: #171211f5; border: 1px solid #91664f; border-radius: 8px; }
	h2 { margin: 0 0 .6em; font-size: clamp(18px, 3vw, 26px); }
	.menu p { margin: .5em 0; }
	.menu ul { display: grid; gap: 4px; list-style: none; margin: .75em 0; padding: 0; }
	.menu li { padding: 6px 10px; background: #33241f; border-radius: 4px; }
	.menu .current { background: #694735; }
	.menu .disabled { color: #b9a59c; }
	.controls { position: absolute; top: 8px; right: 8px; display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
	.controls span, .subtitle { background: #100e0ef2; padding: 6px 10px; border-radius: 4px; }
	.subtitle { position: absolute; left: 12%; right: 12%; bottom: 3%; margin: 0; color: #f6eade; text-align: center; }
</style>
