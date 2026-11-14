<script lang="ts">
	import { onMount } from 'svelte';
	import { createAssistant } from '#lib/jarvis/index.js';
	import type { LineId } from '#lib/jarvis/lines.js';
	import type {
		Assistant,
		AssistantMode,
		AssistantState,
		CueId,
		MissionEvent,
		ProtocolStepId,
		Subtitle,
		TtsMode
	} from '#lib/jarvis/types.js';
	import {
		ERROR_LINES,
		EVENT_LINES,
		PROTOCOL,
		SCRIPTED_LINES,
		SPEAKER_COLOR,
		SPEAKER_LABEL,
		STATUS_COLOR,
		STATUS_LABEL,
		lineText,
		scriptedQuestion,
		sendCue,
		telemetryRows
	} from '#lib/jarvis/ui/shared.js';

	type Target = 'local' | 'quest';
	interface LogEntry extends Subtitle {
		key: number;
		at: Date;
	}
	interface SentCue {
		key: number;
		id: CueId;
		at: Date;
		ok: boolean;
		detail: string;
	}

	const EVENTS: { id: MissionEvent; label: string }[] = [
		{ id: 'mission_start', label: 'Mission start' },
		{ id: 'sample_collected', label: 'Sample collected' },
		{ id: 'storm_start', label: 'Storm starts' }
	];
	const CHECKLIST = [
		'ElevenLabs voice selected and credits available (tts=elevenlabs / JARVIS_TTS=elevenlabs).',
		'Reset with mission_start or R on /operator.',
		'The backup phone is recording audio (D18).',
		'The Quest recorder has its microphone enabled.',
		'Save all editor files to avoid hot reloads.'
	];

	const params = new URLSearchParams(location.search);
	let target = $state<Target>(params.get('target') === 'quest' ? 'quest' : 'local');
	let mode = $state<AssistantMode>(params.get('mode') === 'scripted' ? 'scripted' : 'live');
	let tts = $state<TtsMode>(params.get('tts') === 'browser' ? 'browser' : 'elevenlabs');

	let assistant: Assistant | null = null;
	let unsubscribers: (() => void)[] = [];
	let assistantState = $state<AssistantState | null>(null);
	let unlocking = $state(false);
	let unlockError = $state('');
	let pttHeld = $state(false);
	let log = $state<LogEntry[]>([]);
	let sent = $state<SentCue[]>([]);
	let lastSentStep = $state<ProtocolStepId | null>(null);
	let flashed = $state<CueId | null>(null);
	let checks = $state(CHECKLIST.map(() => false));
	let entryKey = 0;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	const locked = $derived(target === 'local' && (!assistantState || assistantState.status === 'locked'));
	const currentStep = $derived(target === 'local' ? (assistantState?.telemetry.protocolStep ?? null) : lastSentStep);
	const checklistDone = $derived(checks.every(Boolean));
	const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour12: false });

	// ---- Local assistant lifecycle -----------------------------------------------

	function createLocal() {
		destroyLocal();
		const a = createAssistant({ mode, tts, cuePolling: false });
		unsubscribers = [
			a.onState((s) => (assistantState = s)),
			a.onSubtitle((s) => {
				log = [{ ...s, key: ++entryKey, at: new Date() }, ...log].slice(0, 100);
			})
		];
		assistant = a;
		assistantState = a.getState();
	}

	function destroyLocal() {
		if (pttHeld) pttUp();
		for (const unsubscribe of unsubscribers) unsubscribe();
		unsubscribers = [];
		assistant?.dispose();
		assistant = null;
		assistantState = null;
		unlockError = '';
	}

	/** Must run inside a click handler (user gesture) — creates the AudioContext + mic stream (D20, D21). */
	async function activateAudio() {
		if (!assistant || unlocking) return;
		unlocking = true;
		unlockError = '';
		try {
			await assistant.unlock();
		} catch (cause) {
			console.error(cause);
			unlockError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			unlocking = false;
		}
	}

	function selectTarget(next: Target) {
		if (next === target) return;
		target = next;
		if (next === 'local') createLocal();
		else destroyLocal();
	}

	/** Recreate the assistant with new options; re-unlock in the same click if audio was already active. */
	function reconfigure(next: { mode?: AssistantMode; tts?: TtsMode }) {
		const wasUnlocked = !locked;
		if (next.mode) mode = next.mode;
		if (next.tts) tts = next.tts;
		if (target !== 'local') return;
		createLocal();
		if (wasUnlocked) void activateAudio();
	}

	// ---- Push-to-talk ---------------------------------------------------------------

	function pttDown() {
		if (target !== 'local' || mode !== 'live' || !assistant || locked || pttHeld) return;
		pttHeld = true;
		assistant.pttDown();
	}

	function pttUp() {
		if (!pttHeld) return;
		pttHeld = false;
		assistant?.pttUp();
	}

	// ---- Cues -------------------------------------------------------------------------

	function flash(id: CueId) {
		flashed = id;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flashed = null), 350);
	}

	function runLocal(a: Assistant, id: CueId) {
		if (id === 'reset') a.reset();
		else if (id.startsWith('step:')) a.setStep(id.slice(5) as ProtocolStepId);
		else if (EVENTS.some((e) => e.id === id)) a.notify(id as MissionEvent);
		else a.playLine(id as LineId);
	}

	async function cue(id: CueId) {
		flash(id);
		if (target === 'local') {
			if (!assistant || locked) return;
			runLocal(assistant, id);
			return;
		}
		if (id.startsWith('step:')) lastSentStep = id.slice(5) as ProtocolStepId;
		if (id === 'reset' || id === 'mission_start') lastSentStep = null;
		const key = ++entryKey;
		const record = (ok: boolean, detail: string) => {
			sent = [{ key, id, at: new Date(), ok, detail }, ...sent].slice(0, 12);
		};
		try {
			const result = await sendCue(id);
			record(true, `seq ${result.seq}`);
		} catch (cause) {
			record(false, cause instanceof Error ? cause.message : String(cause));
		}
	}

	const stepCue = (step: ProtocolStepId): CueId => `step:${step}`;

	// ---- Keyboard ---------------------------------------------------------------------

	function isTextField(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) return false;
		if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
		return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(target.type);
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return;
		if (event.code === 'Space') {
			event.preventDefault(); // no page scroll, no activating the focused button
			if (!event.repeat) pttDown();
			return;
		}
		if (event.repeat) return;
		const digit = /^(?:Digit|Numpad)([1-6])$/.exec(event.code)?.[1];
		if (digit) {
			void cue(stepCue(`P${digit}` as ProtocolStepId));
		} else if (event.code === 'KeyR') {
			void cue('reset');
		}
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.code !== 'Space' || isTextField(event.target)) return;
		event.preventDefault();
		pttUp();
	}

	onMount(() => {
		if (target === 'local') createLocal();
		return () => {
			clearTimeout(flashTimer);
			destroyLocal();
		};
	});
</script>

<svelte:head>
	<title>Sara | Operator</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={pttUp} />

<main>
	<header>
		<div class="identity">
			<span class="planet" aria-hidden="true">◉</span> SARA<span class="divider"></span><span class="subtle">OPERATOR PANEL</span>
		</div>
		<div class="segmented" role="group" aria-label="Target">
			<span class="segmented-label">Target</span>
			<button aria-pressed={target === 'local'} onclick={() => selectTarget('local')}>This laptop</button>
			<button aria-pressed={target === 'quest'} onclick={() => selectTarget('quest')}>Quest headset</button>
		</div>
	</header>

	<section class="hero" aria-label="Status">
		{#if target === 'local'}
			<div class="hero-main">
				{#if locked}
					<button class="unlock" onclick={activateAudio} disabled={unlocking}>
						{unlocking ? 'Enabling…' : 'Enable audio'}
						<small>Grant microphone access to enable audio.</small>
					</button>
				{:else if mode === 'scripted'}
					<div class="ptt scripted-note">
						Scripted mode does not record audio
						<small>Play answers Q1–Q4 after each question.</small>
					</div>
				{:else}
					<button
						class="ptt"
						class:held={pttHeld}
						onpointerdown={(event) => {
							event.currentTarget.setPointerCapture(event.pointerId);
							pttDown();
						}}
						onpointerup={pttUp}
						onpointercancel={pttUp}
						onlostpointercapture={pttUp}
						oncontextmenu={(event) => event.preventDefault()}
					>
						{pttHeld ? 'Recording… release to send' : 'Hold to talk'}
						<small>or hold Space</small>
					</button>
				{/if}
				{#if unlockError}<p class="error" role="alert">Could not enable audio: {unlockError}</p>{/if}
			</div>
			<div class="hero-side">
				{#if assistantState}
					<span class="chip" style:--chip={STATUS_COLOR[assistantState.status]} role="status">
						<span class="dot"></span>{STATUS_LABEL[assistantState.status]}
					</span>
				{/if}
				<div class="segmented" role="group" aria-label="Mode">
					<span class="segmented-label">Mode</span>
					<button aria-pressed={mode === 'live'} onclick={() => reconfigure({ mode: 'live' })}>Live</button>
					<button aria-pressed={mode === 'scripted'} onclick={() => reconfigure({ mode: 'scripted' })}>Scripted</button>
				</div>
				<div class="segmented" role="group" aria-label="Voice">
					<span class="segmented-label">Voice</span>
					<button aria-pressed={tts === 'elevenlabs'} onclick={() => reconfigure({ tts: 'elevenlabs' })}>ElevenLabs</button>
					<button aria-pressed={tts === 'browser'} onclick={() => reconfigure({ tts: 'browser' })}>Browser</button>
				</div>
			</div>
		{:else}
			<div class="hero-main remote">
				<span class="chip" style:--chip="#ed9d71"><span class="dot"></span>Remote control</span>
				<p>
					Each button sends <code>POST /api/cue</code>. The headset polls every 500 ms. Select mode and voice in the
					headset URL, for example <code>/vr-test?mode=scripted&amp;tts=elevenlabs</code>.
				</p>
			</div>
			<div class="hero-side sent" aria-live="polite">
				<h2>Recent cues</h2>
				{#if sent.length === 0}
					<p class="muted">No cues sent yet.</p>
				{:else}
					<ol>
						{#each sent as entry (entry.key)}
							<li class:failed={!entry.ok}>
								<span class="mono">{time(entry.at)}</span>
								<strong>{entry.id}</strong>
								<span>{entry.detail}</span>
							</li>
						{/each}
					</ol>
				{/if}
			</div>
		{/if}
	</section>

	<div class="layout">
		<div class="column">
			<section class="panel" aria-labelledby="events-title" class:dimmed={locked}>
				<h2 id="events-title">Mission events</h2>
				<div class="cue-grid three">
					{#each EVENTS as event (event.id)}
						{@const line = EVENT_LINES.find((l) => l.trigger === event.id)}
						<button class="cue" class:flash={flashed === event.id} disabled={locked} onclick={() => cue(event.id)}
							title={line ? `${line.id}: ${lineText(line.id)}` : undefined}>
							<span class="cue-id">{event.id}</span>
							<span class="cue-name">{event.label}</span>
							{#if line}<span class="cue-text">{line.id} · {lineText(line.id)}</span>{/if}
						</button>
					{/each}
				</div>
			</section>

			<section class="panel" aria-labelledby="lines-title" class:dimmed={locked}>
				<h2 id="lines-title">Preset lines</h2>
				<div class="cue-grid">
					{#each [...EVENT_LINES, ...ERROR_LINES] as line (line.id)}
						<button class="cue" class:flash={flashed === line.id} disabled={locked} onclick={() => cue(line.id)}
							title={lineText(line.id)}>
							<span class="cue-id">{line.id}<span class="cue-trigger">{line.trigger}</span></span>
							<span class="cue-text">{lineText(line.id)}</span>
						</button>
					{/each}
				</div>
				<h3>Scripted answers (level 0)</h3>
				<div class="cue-grid">
					{#each SCRIPTED_LINES as line (line.id)}
						<button class="cue scripted" class:flash={flashed === line.id} disabled={locked} onclick={() => cue(line.id)}
							title={lineText(line.id)}>
							<span class="cue-id">{line.id}<span class="cue-trigger">«{scriptedQuestion(line)}»</span></span>
							<span class="cue-text">{lineText(line.id)}</span>
						</button>
					{/each}
				</div>
			</section>

			<section class="panel" aria-labelledby="protocol-title" class:dimmed={locked}>
				<div class="panel-head">
					<h2 id="protocol-title">Storm protocol</h2>
					<span class="hint">Keys 1–6 · {target === 'local' ? 'current step' : 'last sent'} highlighted</span>
				</div>
				<div class="steps">
					{#each PROTOCOL as step, index (step.id)}
						<button class="step" class:current={currentStep === step.id} class:flash={flashed === stepCue(step.id)}
							disabled={locked} onclick={() => cue(stepCue(step.id))}>
							<kbd>{index + 1}</kbd>
							<span class="step-body">
								<span class="step-name">{step.id} · {step.name}</span>
								<span class="step-text">{step.instruction}</span>
							</span>
						</button>
					{/each}
				</div>
				<button class="reset" class:flash={flashed === 'reset'} disabled={locked} onclick={() => cue('reset')}>
					<kbd>R</kbd> Reset take <span class="muted">— clear history, telemetry clock and audio queue</span>
				</button>
			</section>
		</div>

		<div class="column">
			{#if target === 'local'}
				<section class="panel" aria-labelledby="telemetry-title">
					<div class="panel-head">
						<h2 id="telemetry-title">Telemetry</h2>
						<span class="hint">{mode === 'live' ? 'Live' : 'Scripted'} · {tts === 'elevenlabs' ? 'ElevenLabs' : 'Browser'}</span>
					</div>
					{#if assistantState}
						<table>
							<tbody>
								{#each telemetryRows(assistantState.telemetry) as [label, value] (label)}
									<tr><th scope="row">{label}</th><td>{value}</td></tr>
								{/each}
							</tbody>
						</table>
						{#if assistantState.lastError}
							<p class="error" role="alert">Last error: {assistantState.lastError}</p>
						{/if}
					{:else}
						<p class="muted">Assistant unavailable.</p>
					{/if}
				</section>

				<section class="panel" aria-labelledby="log-title">
					<div class="panel-head">
						<h2 id="log-title">Transcript</h2>
						<button class="link" onclick={() => (log = [])} disabled={log.length === 0}>Clear</button>
					</div>
					{#if log.length === 0}
						<p class="muted">Astronaut questions and SARA replies appear here, newest first.</p>
					{:else}
						<ol class="log" aria-live="polite">
							{#each log as entry (entry.key)}
								<li style:--speaker={SPEAKER_COLOR[entry.speaker]}>
									<span class="log-meta"><strong>{SPEAKER_LABEL[entry.speaker]}</strong> · turn {entry.turnId} · {time(entry.at)}</span>
									<span>{entry.text}</span>
								</li>
							{/each}
						</ol>
					{/if}
				</section>
			{/if}

			<section class="panel" aria-labelledby="checklist-title">
				<div class="panel-head">
					<h2 id="checklist-title">Pre-take checklist</h2>
					<span class="hint" class:ok={checklistDone}>{checks.filter(Boolean).length}/{checks.length}</span>
				</div>
				<ul class="checklist">
					{#each CHECKLIST as item, index (item)}
						<li><label><input type="checkbox" bind:checked={checks[index]} /> <span>{item}</span></label></li>
					{/each}
				</ul>
				<button class="link" onclick={() => (checks = CHECKLIST.map(() => false))}>Uncheck all</button>
			</section>

			<section class="panel" aria-labelledby="script-title">
				<h2 id="script-title">Level 0 script</h2>
				<p class="muted">
					Play each answer after your teammate reads the question. Scene events such as storm_start play
					their lines automatically.
				</p>
				<ol class="script">
					{#each SCRIPTED_LINES as line (line.id)}
						<li>
							<span class="question">«{scriptedQuestion(line)}»</span>
							<span class="answer">→ pulsa <strong>{line.id}</strong></span>
						</li>
					{/each}
				</ol>
			</section>
		</div>
	</div>
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #100e0e; color: #f6eade; font-family: system-ui, sans-serif; }
	main { max-width: 1500px; margin: auto; padding: 0 clamp(16px, 3vw, 40px) 40px; }
	header { min-height: 66px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; }
	.identity, .segmented-label, .cue-id, .hint, kbd, .mono, .log-meta, th, td, code { font-family: ui-monospace, monospace; }
	.identity { display: flex; align-items: center; gap: 12px; font-size: 12px; letter-spacing: 0.11em; font-weight: 700; }
	.planet { color: #ed9d71; font-size: 20px; }
	.divider { height: 16px; width: 1px; background: #50392e; }
	.subtle { color: #bcaeaa; font-weight: 400; }
	h2, h3 { font-family: Georgia, serif; font-weight: 400; letter-spacing: -0.02em; margin: 0 0 12px; }
	h2 { font-size: 21px; }
	h3 { font-size: 16px; margin-top: 18px; color: #e7cdbd; }
	button { font: inherit; color: #f3dace; cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.5; }
	button:focus-visible, input:focus-visible { outline: 2px solid #ffb689; outline-offset: 2px; }
	code { font-size: 0.92em; color: #f6bf98; }
	.muted { color: #b19a8c; font-size: 13px; }
	.error { color: #ff9c8a; font-size: 13px; margin: 10px 0 0; }

	.segmented { display: inline-flex; align-items: center; border: 1px solid #67483a; background: #1d1715; border-radius: 8px; padding: 4px; gap: 4px; }
	.segmented-label { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b19a8c; padding: 0 8px 0 6px; }
	.segmented button { border: 0; border-radius: 4px; padding: 7px 12px; background: transparent; font-size: 13px; }
	.segmented button:hover, .segmented button[aria-pressed='true'] { background: #5d392b; color: #fff0df; }

	.hero { display: flex; flex-wrap: wrap; gap: 16px; align-items: stretch; padding: 18px; border: 1px solid #47352c; border-radius: 16px; background: radial-gradient(ellipse at 20% 40%, #35221a, #1b1513 70%); margin-bottom: 18px; }
	.hero-main { flex: 1 1 380px; display: flex; flex-direction: column; justify-content: center; }
	.hero-side { flex: 0 1 auto; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
	.unlock, .ptt { width: 100%; min-height: 120px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-family: Georgia, serif; font-size: clamp(22px, 3vw, 32px); }
	.unlock small, .ptt small { font-family: system-ui, sans-serif; font-size: 13px; color: #d9c2b4; }
	.unlock { border: 2px solid #ed9d71; background: #5d392b; color: #fff0df; }
	.unlock:hover:not(:disabled) { background: #74462f; }
	.ptt { border: 2px dashed #67483a; background: #1d1715; touch-action: none; user-select: none; -webkit-user-select: none; }
	.ptt:hover:not(.scripted-note) { border-color: #ed9d71; }
	.scripted-note { padding: 16px; text-align: center; color: #d9c2b4; }
	.ptt.held { border-style: solid; border-color: #ff6b5a; background: #4a1f19; color: #fff0df; }
	.remote p { margin: 12px 0 0; color: #d9c2b4; font-size: 14px; max-width: 60ch; line-height: 1.5; }
	.chip { --chip: #9fc49a; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--chip); color: var(--chip); font: 600 12px/1 ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; align-self: flex-start; }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--chip); }
	.sent { min-width: min(100%, 360px); }
	.sent h2 { font-size: 16px; margin-bottom: 6px; }
	.sent ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
	.sent li { display: flex; gap: 10px; }
	.sent li strong { color: #f3ab82; }
	.sent li.failed span:last-child { color: #ff9c8a; }

	.layout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 18px; align-items: start; }
	.column { display: grid; gap: 18px; }
	.panel { border: 1px solid #47352c; border-radius: 14px; background: #171312; padding: 18px; }
	.panel.dimmed { opacity: 0.75; }
	.panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
	.hint { font-size: 11px; color: #b19a8c; letter-spacing: 0.06em; }
	.hint.ok { color: #9fc49a; }

	.cue-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
	.cue-grid.three { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
	.cue { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 10px 12px; border: 1px solid #47352c; border-radius: 8px; background: #1d1715; transition: background 0.15s, border-color 0.15s; }
	.cue:hover:not(:disabled) { border-color: #ed9d71; background: #2a1d18; }
	.cue.scripted { border-color: #5a4334; }
	.cue-id { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 700; color: #f3ab82; }
	.cue-trigger { font-weight: 400; color: #b19a8c; font-size: 11px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.cue-name { font-family: Georgia, serif; font-size: 17px; }
	.cue-text { font-size: 12px; color: #cdb7aa; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.flash { background: #74462f !important; border-color: #f3ab82 !important; }

	.steps { display: grid; gap: 6px; }
	.step { display: flex; gap: 12px; align-items: flex-start; text-align: left; padding: 10px 12px; border: 1px solid #47352c; border-radius: 8px; background: #1d1715; }
	.step:hover:not(:disabled) { border-color: #ed9d71; }
	.step.current { border-color: #ed9d71; background: #3a241b; box-shadow: inset 4px 0 0 #ed9d71; }
	.step-body { display: flex; flex-direction: column; gap: 2px; }
	.step-name { font-weight: 700; font-size: 14px; letter-spacing: 0.03em; }
	.step-text { font-size: 13px; color: #cdb7aa; line-height: 1.4; }
	kbd { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border: 1px solid #67483a; border-bottom-width: 2px; border-radius: 4px; font-size: 12px; color: #f6bf98; background: #100e0e; flex-shrink: 0; }
	.reset { margin-top: 12px; width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #67483a; border-radius: 8px; background: #241915; text-align: left; font-weight: 600; }
	.reset:hover:not(:disabled) { border-color: #ed9d71; }
	.reset .muted { font-weight: 400; }

	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	th, td { padding: 6px 0; border-bottom: 1px solid #2c221e; }
	th { text-align: left; font-weight: 400; color: #b19a8c; }
	td { text-align: right; color: #f6eade; font-variant-numeric: tabular-nums; }

	.link { border: 0; background: none; color: #f6bf98; text-decoration: underline; text-underline-offset: 3px; font-size: 13px; padding: 0; }
	.log { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-height: 420px; overflow-y: auto; }
	.log li { --speaker: #f6eade; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; background: #1d1715; border-radius: 6px; font-size: 14px; line-height: 1.4; }
	.log-meta { font-size: 11px; color: #b19a8c; }
	.log-meta strong { color: var(--speaker); }

	.checklist { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 8px; font-size: 14px; }
	.checklist label { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; line-height: 1.4; }
	.checklist input { accent-color: #ed9d71; margin-top: 3px; width: 16px; height: 16px; flex-shrink: 0; }
	.checklist input:checked + span { color: #b19a8c; text-decoration: line-through; }

	.script { margin: 10px 0 0; padding-left: 20px; display: grid; gap: 8px; font-size: 15px; }
	.question { font-family: Georgia, serif; }
	.answer { display: block; font-size: 13px; color: #b19a8c; }
	.answer strong { color: #f3ab82; font-family: ui-monospace, monospace; }

	@media (max-width: 900px) {
		.layout { grid-template-columns: minmax(0, 1fr); }
	}
</style>
