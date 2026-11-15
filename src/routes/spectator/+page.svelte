<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { createSpectator } from '#lib/visor/share-client.js';
	import { CODE_PATTERN, displayCode, normalizeCode } from '#lib/visor/share-protocol.js';

	let code = $state('');
	let status = $state('');
	let active = $state(false);
	let playing = $state(false);
	let video: HTMLVideoElement;
	let session: ReturnType<typeof createSpectator> | undefined;

	function disconnect() {
		session?.close();
		session = undefined;
		if (video) video.srcObject = null;
		active = playing = false;
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
		session = createSpectator(normalized, (stream) => {
			video.srcObject = stream;
			void video.play().catch(() => { status = 'Pulsa reproducir para ver la transmisión.'; });
		}, (message, room) => {
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
		<!-- svelte-ignore a11y_media_has_caption (video-only stream; the headset's subtitles are already in the image) -->
		<video bind:this={video} autoplay muted playsinline controls onplaying={() => { playing = true; status = 'En directo'; }}
			onwaiting={() => { playing = false; if (active) status = 'Esperando vídeo…'; }} aria-label="Vista de las gafas en directo"></video>
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
	.screen { border: 1px solid #47352c; border-radius: 10px; overflow: hidden; background: #090808; }
	video { display: block; width: 100%; max-height: 76vh; min-height: 200px; }
</style>
