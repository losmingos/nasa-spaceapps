<script lang="ts">
	import { onMount } from 'svelte';

	let { mission, title, paragraphs, complete, ready, unavailable, onprimary, onback }: {
		mission: string;
		title: string;
		paragraphs: readonly string[];
		complete: boolean;
		ready: boolean;
		unavailable: boolean;
		onprimary: () => void;
		onback: () => void;
	} = $props();

	let heading: HTMLHeadingElement;
	onMount(() => heading.focus());
</script>

<div class="mission-screen">
	<section class="mission-card" class:complete aria-labelledby="mission-screen-title">
		<header>
			<p class="mission-name">{mission}</p>
			<h1 id="mission-screen-title" tabindex="-1" bind:this={heading}>{title}</h1>
		</header>
		<div class="summary">
			{#each paragraphs as paragraph}
				<p>{paragraph}</p>
			{/each}
		</div>
		{#if !complete}
			<p class="controls">WASD to move or drive · Arrow keys to look · E / 1 / 2 to act · Hold Space to talk to SARA</p>
		{/if}
		<div class="screen-actions">
			<button class="hud-action primary" type="button" disabled={!ready}
				aria-keyshortcuts={complete ? 'R' : 'I'} onclick={onprimary}>
				{complete ? 'Restart mission' : 'Start mission'} <kbd>{complete ? 'R' : 'I'}</kbd>
			</button>
			{#if complete}
				<button class="hud-action" type="button" aria-keyshortcuts="Q" onclick={onback}>
					Back to briefing <kbd>Q</kbd>
				</button>
			{:else if !ready}
				<p class="loading" role="status">{unavailable ? 'Terrain unavailable. Reload to try again.' : 'Loading terrain…'}</p>
			{/if}
		</div>
	</section>
</div>

<style>
	.mission-screen {
		position: absolute;
		z-index: 2;
		inset: 0;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		place-items: center;
		padding: max(88px, calc(env(safe-area-inset-top) + 76px)) 16px max(16px, env(safe-area-inset-bottom));
		background: radial-gradient(ellipse at center, #07141099 20%, #07141038 60%, transparent 85%);
		pointer-events: none;
	}

	.mission-card {
		--accent: #f4cc96;
		display: grid;
		gap: clamp(14px, 3dvh, 24px);
		width: min(100%, 590px);
		max-height: 100%;
		overflow: auto;
		padding: clamp(20px, 5vw, 44px);
		border: 1px solid #a5d6c75c;
		border-top: 3px solid var(--accent);
		background: linear-gradient(150deg, #162725, #091411 86%);
		box-shadow: 0 18px 68px #04100e8c;
		pointer-events: auto;
	}

	.complete { --accent: #9de8c9; }

	.mission-name, .controls, kbd {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
	}

	.mission-name {
		margin: 0 0 9px;
		color: var(--accent);
		font-size: .79rem;
		letter-spacing: .025em;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 5.2vw, 3.25rem);
		font-weight: 650;
		letter-spacing: -.045em;
		line-height: 1.06;
	}
	h1:focus { outline: none; }

	.summary {
		display: grid;
		gap: 6px;
		font-size: clamp(.96rem, 2vw, 1.1rem);
		line-height: 1.5;
	}
	.summary p, .controls, .loading { margin: 0; }
	.controls {
		color: var(--hud-label);
		font-size: .75rem;
		line-height: 1.6;
	}

	.screen-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
	.screen-actions .hud-action { padding-inline: 12px; }
	.primary { background: var(--accent); color: #11221c; text-shadow: none; border: 0; }
	.primary:hover:not(:disabled) { background: #ecfff7; }
	kbd {
		padding: 2px 4px;
		border: 1px solid currentColor;
		border-radius: 3px;
		font-size: .68rem;
		line-height: 1;
	}
	.loading { font-size: .8rem; color: var(--hud-label); }

	@media (max-height: 500px) {
		.mission-card { align-self: start; padding: 16px 20px; gap: 12px; }
	}
</style>
