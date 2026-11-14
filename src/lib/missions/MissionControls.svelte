<script lang="ts" generics="Action extends string">
	let {
		id, menuLabel, running, open, onmenu, menubutton = $bindable(),
		actions, actionLabels, paused, onact, testing, fast, ontest, children
	}: {
		id: string;
		menuLabel: string;
		running: boolean;
		open: boolean;
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
	{#if testing}
		<button class="hud-action" aria-pressed={fast} aria-keyshortcuts="T" onclick={ontest}>Test speed {fast ? '4×' : '1×'} [T]</button>
	{/if}
	{#each actions as action, index (action)}
		<button class="hud-action" disabled={paused} onclick={() => onact(action)}>
			{actionLabels[action]} [{index === 0 ? 'E / 1' : '2'}]
		</button>
	{/each}
	<button class="hud-action" bind:this={menubutton} aria-expanded={open} aria-controls={id}
		onclick={onmenu}>{running ? 'Mission' : menuLabel}</button>

	<div {id} class="mission-options t-panel-slide" data-open={open} inert={!open} aria-hidden={!open}>
		{@render children()}
	</div>
</section>
