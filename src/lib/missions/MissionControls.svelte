<script lang="ts" generics="Action extends string">
	import VisorIcon from '../visor/VisorIcon.svelte';
	let {
		id, menuLabel, running, open, immersive, onmenu, menubutton = $bindable(),
		actions, actionLabels, paused, onact, testing, fast, ontest, children
	}: {
		id: string;
		menuLabel: string;
		running: boolean;
		open: boolean;
		immersive: boolean;
		onmenu: () => void;
		menubutton?: HTMLButtonElement;
		actions: readonly Action[];
		actionLabels: Record<Action, string>;
		paused: boolean;
		onact: (action: Action) => void;
		testing: boolean;
		fast: boolean;
		ontest: () => void;
		children: import('svelte').Snippet;
	} = $props();
</script>

<section class="mission-controls" aria-label={menuLabel}>
	<div class="hud-actions mission-steps">
		{#if testing}
			<button class="hud-action" aria-pressed={fast} aria-keyshortcuts="T" onclick={ontest}>Test speed {fast ? '4×' : '1×'} {#if !immersive}[T]{/if}</button>
		{/if}
		{#each actions as action, index (action)}
			<button class="hud-action" disabled={paused} onclick={() => onact(action)}>
				{#if immersive}<VisorIcon name="action" />{/if}
				{actionLabels[action]}{#if !immersive} [{index === 0 ? 'E / 1' : '2'}]{/if}
			</button>
		{/each}
	</div>
	<button class="hud-action mission-toggle" aria-label={running ? 'Mission' : menuLabel} bind:this={menubutton} aria-expanded={open} aria-controls={id}
		onclick={onmenu}>{#if immersive}<VisorIcon name="mission" />{:else}{running ? 'Mission' : menuLabel}{/if}</button>

	<div {id} class="mission-options t-panel-slide" data-open={open} inert={!open} aria-hidden={!open}>
		{@render children()}
	</div>
</section>
