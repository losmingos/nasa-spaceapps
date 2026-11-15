<script lang="ts">
	import { onMount, tick } from 'svelte';
	import MissionControls from '../MissionControls.svelte';
	import { dialogueAt, type Ares01Dialogue } from './ares01.js';
	import { actInteractive, availableActions, interactiveSnapshot, startInteractive, stepInteractive, type MissionAction } from './interactive.js';
	import type { Ares01View } from './visor.js';
	import type { XrMenuItem } from '../../visor/xr-controls.js';
	import { DETOUR_EXTRA, type Point } from './route.js';

	let { ready, immersive, onview, ondialogue, onstart, onpause, focusScene, getPosition }: {
		ready: boolean;
		immersive: boolean;
		onview: (view?: Ares01View) => void;
		ondialogue: (line: Ares01Dialogue, interactive: boolean) => void;
		onstart: () => void;
		onpause: () => void;
		focusScene: () => void;
		getPosition: () => Point | undefined;
	} = $props();

	let mode = $state<'interactive'>();
	let menuOpen = $state(false);
	let menuButton = $state<HTMLButtonElement>();
	let paused = $state(false);
	let testing = $state(false);
	let fastTravel = $state(false);
	let run = $state.raw(startInteractive());
	let runId = $state(0);
	let lastCue = '';
	const player = $derived(mode === 'interactive' ? interactiveSnapshot(run) : undefined);
	const snapshot = $derived(interactiveSnapshot(run));
	const elapsed = $derived(run.elapsed);
	const finished = $derived(snapshot.cue.id === 'closed');
	const actions = $derived(player ? availableActions(run) : []);
	const actionLabels: Record<MissionAction, string> = {
		drill: 'Start drilling',
		continue: 'Continue sampling',
		abort: 'Stop drilling',
		secure: 'Secure equipment and save log',
		collect: 'Collect the three survey samples',
		detour: `Accept detour (+${DETOUR_EXTRA} m)`,
		check: 'Check suit pressure',
		resume: 'Resume walking',
		locate: 'Confirm position using beacon',
		board: 'Enter and pressurize the rover',
		drive: 'Start driving',
		finish: 'Park and complete mission'
	};

	function start(next: typeof mode) {
		menuOpen = false;
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
		if (next.phase === 'closed') {
			menuOpen = false;
			if (document.pointerLockElement) document.exitPointerLock();
		} else void tick().then(focusScene);
	}

	function togglePause() {
		paused = !paused;
		if (paused) onpause();
		else {
			lastCue = '';
			if (player?.move) focusScene();
		}
	}

	export function getVrControls(): XrMenuItem[] {
		if (!ready) return [];
		if (!mode) return [
			{ id: 'start', label: 'Start mission', run: () => start('interactive'), close: true }
		];

		const items: XrMenuItem[] = paused ? [] : actions.map((action) => ({
			id: action, label: actionLabels[action], run: () => perform(action), close: true
		}));
		if (!finished) items.push({
			id: 'pause', label: paused ? 'Resume mission' : 'Pause mission',
			run: togglePause, close: paused
		});
		if (testing && mode === 'interactive' && !finished) items.push({
			id: 'speed', label: fastTravel ? 'Test speed · 4×' : 'Test speed · 1×',
			run: () => { fastTravel = !fastTravel; }
		});
		items.push(
			{ id: 'restart', label: 'Restart mission', run: () => start(mode), close: true },
			{ id: 'leave', label: 'Exit mission', run: () => start(undefined) }
		);
		return items;
	}

	function keyboard(event: KeyboardEvent) {
		if (event.code === 'Escape' && menuOpen) {
			menuOpen = false;
			menuButton?.focus();
			return;
		}
		if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
			(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))) return;
		if (!mode) {
			if (event.code === 'KeyM' && ready) {
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
			if (!mode || paused || finished || (document.hidden && !immersive)) return;
			run = stepInteractive(run, delta, getPosition() ?? run.position);
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

{#if mode && !finished}
	<MissionControls id="mission-options" menuLabel="ARES-01" running={!!mode} open={menuOpen}
		onmenu={() => { menuOpen = !menuOpen; }} bind:menubutton={menuButton}
		{actions} {actionLabels} {paused} onact={perform}
		testing={testing && mode === 'interactive' && !finished} fast={fastTravel}
		ontest={() => { fastTravel = !fastTravel; focusScene(); }}>
		<div class="hud-actions">
			<button class="hud-action" onclick={togglePause}>{paused ? 'Resume' : 'Pause'} [P]</button>
			<button class="hud-action" onclick={() => start(mode)}>Restart</button>
			<button class="hud-action" onclick={() => start(undefined)}>Exit</button>
		</div>
	</MissionControls>
{/if}
