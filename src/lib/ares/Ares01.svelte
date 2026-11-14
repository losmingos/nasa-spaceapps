<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { dialogueAt, DURATION, missionAt, type Ares01Dialogue, type MissionSnapshot } from './ares01.js';
	import { actInteractive, availableActions, interactiveSnapshot, startInteractive, stepInteractive, type MissionAction } from './interactive.js';
	import type { Point } from './route.js';

	let { ready, onview, ondialogue, onstart, onpause, focusScene, getPosition }: {
		ready: boolean;
		onview: (view?: MissionSnapshot & {
			time: number;
			paused: boolean;
			player?: ReturnType<typeof interactiveSnapshot> & { run: number; enabled: boolean; speedMultiplier: number };
		}) => void;
		ondialogue: (line: Ares01Dialogue, interactive: boolean) => void;
		onstart: () => void;
		onpause: () => void;
		focusScene: () => void;
		getPosition: () => Point | undefined;
	} = $props();

	let mode = $state<'demo' | 'interactive'>();
	let menuOpen = $state(false);
	let menuButton: HTMLButtonElement;
	let time = $state(0);
	let paused = $state(false);
	let testing = $state(false);
	let fastTravel = $state(false);
	let run = $state.raw(startInteractive());
	let runId = $state(0);
	let lastCue = '';
	const player = $derived(mode === 'interactive' ? interactiveSnapshot(run) : undefined);
	const snapshot = $derived(player ?? missionAt(time, time >= 25 ? 'continue' : undefined));
	const elapsed = $derived(player ? run.elapsed : time);
	const finished = $derived(snapshot.cue.id === 'closed');
	const actions = $derived(player ? availableActions(run) : []);
	const actionLabels: Record<MissionAction, string> = {
		drill: 'Start drilling',
		continue: 'Continue sampling',
		abort: 'Stop drilling',
		secure: 'Secure equipment and save log',
		detour: 'Accept detour (+65 m)',
		check: 'Check suit pressure',
		resume: 'Resume walking',
		locate: 'Confirm position using beacon',
		board: 'Enter and pressurize the rover',
		drive: 'Start driving',
		finish: 'Park and complete mission'
	};

	function start(next: typeof mode) {
		menuOpen = false;
		time = 0;
		mode = next;
		paused = false;
		fastTravel = false;
		run = startInteractive();
		runId++;
		lastCue = '';
		onpause();
		if (next === 'interactive') onstart();
		if (document.pointerLockElement) document.exitPointerLock();
		if (next === 'interactive') void tick().then(focusScene);
	}

	function perform(action: MissionAction) {
		if (paused || mode !== 'interactive') return;
		const next = actInteractive(run, action);
		if (next === run) return;
		run = next;
		void tick().then(focusScene);
	}

	function togglePause() {
		paused = !paused;
		if (paused) onpause();
		else {
			lastCue = '';
			if (player?.move) focusScene();
		}
	}

	function keyboard(event: KeyboardEvent) {
		if (event.code === 'Escape' && menuOpen) {
			menuOpen = false;
			menuButton.focus();
			return;
		}
		if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
			(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))) return;
		if (!mode) {
			if (event.code === 'KeyI' && ready) {
				event.preventDefault();
				start('interactive');
			}
			return;
		}
		if (event.code === 'KeyT' && testing && mode === 'interactive' && !finished) {
			event.preventDefault();
			fastTravel = !fastTravel;
		} else if (event.code === 'KeyP' && !finished) {
			event.preventDefault();
			togglePause();
			void tick().then(focusScene);
		} else if (event.code === 'KeyR' && (paused || finished)) {
			event.preventDefault();
			start(mode);
		} else if (event.code === 'KeyQ' && (paused || finished)) {
			event.preventDefault();
			start(undefined);
		} else if (mode === 'interactive' && !paused) {
			const index = event.code === 'KeyE' || event.code === 'Digit1' || event.code === 'Numpad1' ? 0
				: event.code === 'Digit2' || event.code === 'Numpad2' ? 1 : -1;
			if (index >= 0 && actions[index]) {
				event.preventDefault();
				perform(actions[index]);
			}
		}
	}

	onMount(() => {
		testing = new URLSearchParams(location.search).get('test') === '1';
		let previous = performance.now();
		const timer = setInterval(() => {
			const now = performance.now();
			const delta = Math.min((now - previous) / 1000, 0.25);
			previous = now;
			if (!mode || paused || finished || document.hidden) return;
			if (mode === 'demo') time = Math.min(DURATION, time + delta);
			else run = stepInteractive(run, delta, getPosition() ?? run.position);
		}, 100);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (!mode) {
			onview();
			return;
		}
		onview({ ...snapshot, time: elapsed, paused, player: player && { ...player, run: runId, enabled: player.move && !paused, speedMultiplier: fastTravel ? 4 : 1 } });
		if (!paused && lastCue !== snapshot.cue.id) {
			lastCue = snapshot.cue.id;
			ondialogue(dialogueAt(elapsed, snapshot), !!player);
		}
	});

</script>

<svelte:window onkeydown={keyboard} />

<section class="mission-controls" aria-label="ARES-01 · Simulation">
	{#if testing && mode === 'interactive' && !finished}
		<button class="hud-action" aria-pressed={fastTravel} aria-keyshortcuts="T" onclick={() => {
			fastTravel = !fastTravel;
			focusScene();
		}}>Test speed {fastTravel ? '4×' : '1×'} [T]</button>
	{/if}
	{#each actions as action, index (action)}
		<button class="hud-action" disabled={paused} onclick={() => perform(action)}>
			{actionLabels[action]} [{index === 0 ? 'E / 1' : '2'}]
		</button>
	{/each}
	<button class="hud-action" bind:this={menuButton} aria-expanded={menuOpen} aria-controls="mission-options"
		onclick={() => { menuOpen = !menuOpen; }}>{mode ? 'Mission' : 'ARES-01'}</button>

	<div id="mission-options" class="mission-options t-panel-slide" data-open={menuOpen}
		inert={!menuOpen} aria-hidden={!menuOpen}>
		{#if !mode}
			<span>The Last Sample · Simulation</span>
			<p>WASD move · Arrow keys look · E / 1 / 2 act · Space talk</p>
			<div class="hud-actions">
				<button class="hud-action" disabled={!ready} onclick={() => start('interactive')}>Start mission [I]</button>
				<button class="hud-action" disabled={!ready} onclick={() => start('demo')}>Watch demo · 3:30</button>
			</div>
		{:else if finished}
			<p>Core not collected. Return to base complete.</p>
			{#if snapshot.log}<p>{snapshot.log.strata}. {snapshot.log.progress}.</p>{/if}
			<div class="hud-actions">
				<button class="hud-action" onclick={() => start(mode)}>Restart</button>
				<button class="hud-action" onclick={() => start(undefined)}>Exit</button>
			</div>
		{:else}
			<div class="hud-actions">
				<button class="hud-action" onclick={togglePause}>{paused ? 'Resume' : 'Pause'} [P]</button>
				<button class="hud-action" onclick={() => start(mode)}>Restart</button>
				<button class="hud-action" onclick={() => start(undefined)}>Exit</button>
			</div>
		{/if}
	</div>
</section>
