<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { asset, resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { createAssistant, placesFrom, type Assistant, type AssistantState } from '#lib/jarvis/index.js';
	import { BUTTON_ZOOM_STEP, MAP_MAX_ZOOM, MAP_MIN_ZOOM, clampMapZoom, voiceMapZoom } from '#lib/jarvis/visor-control.js';
	import { createMissionVoice } from '#lib/jarvis/mission-voice.js';
	import { STATUS_LABEL } from '#lib/jarvis/ui/shared.js';
	import { mountTerrain, type GeologyData, type TerrainDisplayMode, type TerrainNotice } from '#lib/visor/terrain.js';
	import { formatMarsTime, jezeroTime } from '#lib/visor/mars-time.js';
	import '../../routes/visor.css';
	let { ares01 = false, ares02 = false }: { ares01?: boolean; ares02?: boolean } = $props();
	import MissionScreen from '#lib/missions/MissionScreen.svelte';
	import { missionBriefings } from '#lib/missions/mission-briefings.js';
	import Ares02 from '#lib/missions/ares02/Ares02.svelte';
	import type { NightfallView } from '#lib/missions/ares02/visor.js';
	import { createNightfallScene } from '#lib/missions/ares02/scene.js';
	import { BASE, ROVER, SAMPLE } from '#lib/missions/ares01/route.js';
	import { bravo } from '#lib/missions/ares02/route.js';
	import Ares01 from '#lib/missions/ares01/Ares01.svelte';
	import type { Ares01Dialogue } from '#lib/missions/ares01/ares01.js';
	import { createMissionScene, missionContext, missionMessage, missionTerrainView, type Ares01View } from '#lib/missions/ares01/visor.js';
	import VisorIcon from './VisorIcon.svelte';
	import type { XrMenuItem, XrMenuPage } from './xr-controls.js';
	import type { VisorMessage } from '#lib/visor/optics.js';

	let canvas: HTMLCanvasElement;
	let map: HTMLCanvasElement;
	let messageText: HTMLSpanElement;
	let terrain = $state<ReturnType<typeof mountTerrain>>();
	let vrSupported = $state(false);
	let vrBusy = $state(false);
	let vrAudioPrepared = false;
	let preparingVrAudio = $state(false);
	let vrAudioNotice = $state('');
	let visor: HTMLElement;
	let inVR = $state(false);
	let aresControls = $state.raw<ReturnType<typeof Ares01>>();
	let nightfallControls = $state.raw<ReturnType<typeof Ares02>>();
	let vrPage: 'main' | 'mission' | 'missions' | 'settings' | 'map' | 'scene' | 'sol' | 'time' | 'help' = 'main';
	let vrDigits = '';
	let vrError = $state('');
	let notice = $state<'loading' | 'error' | TerrainNotice>('loading');
	let noticeTimer: ReturnType<typeof setTimeout>;
	let exited = $state(false);
	let now = $state(Date.now());
	let selectedSol = $state<number>();
	const localSol = $derived(selectedSol ?? jezeroTime(now));
	const sol = $derived(Math.floor(localSol));
	let controlsVisible = $state(false);
	let controlsButton = $state<HTMLButtonElement>();
	let storm = $state(false);
	let flashlightOn = $state(false);
	let missionsOpen = $state(false);
	let mapZoom = $state(1);
	let displayMode = $state<TerrainDisplayMode>('visible');
	let dangerRisk = $state(0);
	let dangerMessage = $state<VisorMessage>();
	let previousDisplayMode: TerrainDisplayMode = 'visible';

	let mission = $state.raw<Ares01View>();
	let nightfall = $state.raw<NightfallView>();
	const briefing = $derived(ares02 ? missionBriefings.ares02 : ares01 ? missionBriefings.ares01 : undefined);
	const missionComplete = $derived(mission?.cue.id === 'closed' || nightfall?.state === 'MISSION_CLOSED');
	const missionScreen = $derived(briefing
		? missionComplete ? 'complete' : !mission && !nightfall ? 'briefing' : undefined
		: undefined);
	let sceneQuery = $state('');
	let missionVoice: ReturnType<typeof createMissionVoice> | undefined;
	let pendingMissionLine: string | undefined;
	function flushMissionLine() {
		if (voiceInput || !pendingMissionLine || (voice && !['idle', 'locked'].includes(voice.status))) return;
		const text = pendingMissionLine;
		pendingMissionLine = undefined;
		void missionVoice?.speak(text);
	}
	$effect(() => {
		assistant?.setMissionContext(nightfall?.context ?? (mission ? missionContext(mission) : undefined));
	});
	const sceneSol = $derived(ares02 ? 400 + 21 / 24 : mission ? Math.floor(localSol) + 14 / 24 : localSol);
	const clock = $derived(formatMarsTime(sceneSol));
	let assistant = $state.raw<Assistant>();
	let voice = $state<AssistantState>();
	let unlocking = $state(false);
	let unlockFailed = $state(false);
	let voiceInput: 'pointer' | 'Space' | 'Enter' | 'vr' | undefined;
	const voiceStatus = $derived(voice?.status ?? 'locked');
	const micUnavailable = $derived(voice?.lastError?.startsWith('Microphone unavailable') ?? false);
	const voiceProblem = $derived(voiceStatus === 'locked' || voiceStatus === 'idle'
		? unlockFailed ? 'Audio unavailable' : micUnavailable ? 'Microphone unavailable' : ''
		: '');
	const voiceLabel = $derived(unlocking ? 'Enabling audio…' : voiceProblem ||
		(voiceStatus === 'locked' || voiceStatus === 'idle' ? '' : STATUS_LABEL[voiceStatus]));
	const hudMessage: VisorMessage = $derived(nightfall?.message ?? (mission ? missionMessage(mission) : dangerMessage ?? {
		title: voiceLabel ? `SARA · ${voiceLabel}` : '',
		kind: voiceProblem && !unlocking ? 'danger' : undefined
	}));
	const activeTime = $derived(nightfall?.time ?? mission?.time ?? 0);
	const missionClock = $derived(`${Math.floor(activeTime / 60)}:${String(Math.floor(activeTime % 60)).padStart(2, '0')}`);
	$effect(() => {
		void voiceLabel;
		void clock;
		void sol;
		if (!mission && !nightfall) terrain?.refresh();
	});
	const notices = {
		loading: { text: 'Loading terrain', kind: 'info', label: 'Information' },
		ready: { text: '', kind: 'info', label: 'Information' },
		edge: { text: 'Path blocked', kind: 'warning', label: 'Warning' },
		error: { text: 'Terrain unavailable', kind: 'danger', label: 'Danger' }
	};
	const current = $derived(notices[notice]);
	$effect(() => {
		// Notices also redraw when the astronaut is stationary (rendering is demand-driven).
		void current.text;
		terrain?.refresh();
	});
		$effect(() => terrain?.setTime(sceneSol));
	// MEDA weather replay: same scene clock as the terrain (local sol, mars-time.ts scale).
	// The live clock ticks every five seconds.
	$effect(() => assistant?.setSceneClock(sceneSol));
	// Tell Sara when the visor shows a dust storm: Storm mode, or ARES-01 dust (which starts before the
	// advisory). During ARES-01 the notice is silent because the mission speaks its own lines.
	let stormNotified = false;
	$effect(() => {
		const dusty = mission ? (mission.dust ?? 0) > 0 : storm;
		if (dusty && !stormNotified) {
			stormNotified = true;
			assistant?.notify('storm_start', { silent: !!mission });
		} else if (!dusty && stormNotified) {
			stormNotified = false;
			assistant?.reset();
		}
	});
	$effect(() => terrain?.setDust(ares02 ? 0 : mission?.dust ?? Number(storm)));
	$effect(() => terrain?.setWind(voice?.telemetry.wind_ms ?? null));
	$effect(() => terrain?.setDisplayMode(displayMode));
	$effect(() => terrain?.setMissionView(nightfall?.terrain ?? (mission && missionTerrainView(mission))));
	$effect(() => {
		if (displayMode !== 'danger' || !terrain) {
			dangerRisk = 0;
			dangerMessage = undefined;
			return;
		}
		const scene = terrain;
		let level: 'warning' | 'danger' | undefined;
		let lastTitle = '';
		let lastDetail = '';
		const update = () => {
			const position = scene.getPosition();
			const score = scene.getDangerAt(position.x, position.z);
			dangerRisk = score;
			if (score >= (level === 'danger' ? 0.60 : 0.66)) level = 'danger';
			else if (score >= (level === 'warning' ? 0.30 : 0.33)) level = 'warning';
			else level = undefined;
			const next: VisorMessage | undefined = level === 'danger'
				? { title: 'Terrain danger', detail: `High risk ${Math.round(score * 100)}% — reroute or proceed with extreme caution.`, kind: 'danger' }
				: level === 'warning'
					? { title: 'Terrain caution', detail: `Moderate risk ${Math.round(score * 100)}% — loose soil, slope or rock proximity.`, kind: 'warning' }
					: undefined;
			const title = next?.title ?? '';
			const detail = next?.detail ?? '';
			if (title !== lastTitle || detail !== lastDetail) {
				lastTitle = title;
				lastDetail = detail;
				dangerMessage = next;
				untrack(() => scene.refresh());
			}
		};
		update();
		const timer = setInterval(update, 300);
		return () => clearInterval(timer);
	});

	function playMissionDialogue(line: Ares01Dialogue, interactive: boolean) {
		window.dispatchEvent(new CustomEvent<Ares01Dialogue>('ares01:dialogue', { detail: line }));
		if (interactive && line.speaker === 'jarvis') {
			pendingMissionLine = line.text;
			flushMissionLine();
		}
	}

	function playNightfallDialogue(view: NightfallView) {
		window.dispatchEvent(new CustomEvent('ares02:dialogue', {
			detail: { state: view.state, speaker: view.speaker, text: view.text }
		}));
		pendingMissionLine = view.text;
		flushMissionLine();
	}

	function startMission() {
		voiceInput = undefined;
		assistant?.reset();
		assistant?.startMissionClock();
		missionVoice?.unlock();
	}

	function pauseMission() {
		pendingMissionLine = undefined;
		missionVoice?.stop();
	}

	async function voiceDown(input: NonNullable<typeof voiceInput>) {
		const currentAssistant = assistant;
		if (voiceInput || unlocking || !currentAssistant) return;
		voiceInput = input;
		missionVoice?.stop();
		if (voiceStatus === 'locked' || micUnavailable) {
			unlocking = true;
			unlockFailed = false;
			try {
				await currentAssistant.unlock();
			} catch (cause) {
				console.error('[jarvis] Audio unavailable', cause);
				unlockFailed = true;
				return;
			} finally {
				unlocking = false;
			}
		}
		if (voiceInput === input && assistant === currentAssistant) currentAssistant.pttDown();
	}

	function voiceUp() {
		if (!voiceInput) return;
		voiceInput = undefined;
		assistant?.pttUp();
	}

	function getMissionControls() {
		return (ares02 ? nightfallControls?.getVrControls() : aresControls?.getVrControls()) ?? [];
	}

	function runMissionScreenAction(id: 'start' | 'restart' | 'leave') {
		getMissionControls().find((item) => item.id === id)?.run();
	}

	function toggleFlashlight() {
		flashlightOn = !flashlightOn;
		terrain?.setFlashlight(flashlightOn);
	}

	function toggleSwir() {
		selectDisplayMode(displayMode === 'swir' ? previousDisplayMode : 'swir');
	}

	function resetClock() {
		now = Date.now();
		selectedSol = undefined;
	}

	function changeMapZoom(step: number) {
		mapZoom = clampMapZoom(mapZoom + step);
		terrain?.setMapZoom(mapZoom);
	}

	async function openVrMission(path: '/missions/ares01' | '/missions/ares02') {
		await toggleVR();
		if (!inVR) await goto(resolve(path) + sceneQuery);
	}

	function getVrMenu(): XrMenuPage {
		const back: XrMenuItem = { id: 'back', label: 'Back', run: () => { vrPage = 'main'; } };
		if (briefing && missionScreen) {
			return {
				title: briefing.id + ' · ' + (missionComplete ? 'Mission complete' : briefing.title),
				lines: [...(missionComplete ? briefing.debrief : briefing.briefing)],
				items: [
					...getMissionControls().map((item) => item.id === 'leave' ? { ...item, label: 'Back to briefing' } : item),
					{ id: 'exit-vr', label: 'Exit VR', run: () => { void toggleVR(); } }
				],
				hint: missionComplete ? 'Trigger: select' : 'A or trigger on Start mission'
			};
		}
		if (vrPage === 'missions') {
			return {
				title: 'Select a mission',
				items: [
					{ id: 'ares01', label: 'ARES-01 · The Last Sample', run: () => { void openVrMission('/missions/ares01'); } },
					{ id: 'ares02', label: 'ARES-02 · Nightfall Protocol', run: () => { void openVrMission('/missions/ares02'); } },
					back
				],
				hint: 'Select a mission, then choose Enter VR on its briefing page'
			};
		}
		if (vrPage === 'map') {
			return { title: 'Minimap', items: [
				{ id: 'zoom-in', label: 'Zoom in', disabled: mapZoom >= MAP_MAX_ZOOM, run: () => changeMapZoom(BUTTON_ZOOM_STEP) },
				{ id: 'zoom-out', label: 'Zoom out', disabled: mapZoom <= MAP_MIN_ZOOM, run: () => changeMapZoom(-BUTTON_ZOOM_STEP) },
				back
			] };
		}
		if (vrPage === 'settings') {
			return { title: 'Visor settings', items: [
				{ id: 'flashlight', label: 'Flashlight', active: flashlightOn, run: toggleFlashlight },
				{ id: 'map', label: 'Minimap', run: () => { vrPage = 'map'; } },
				...(!mission && !nightfall && !ares02
					? [{ id: 'scene', label: 'Scene controls', run: () => { vrPage = 'scene'; } }]
					: []),
				{ id: 'help', label: 'Controller help', run: () => { vrPage = 'help'; } },
				{ id: 'exit', label: 'Exit VR', run: () => { void toggleVR(); } }, back
			] };
		}
		if (vrPage === 'help') {
			return {
				title: 'Touch controls',
				items: [back],
				hint: 'Left stick: move or drive · Right stick: turn',
				lines: [
					'Left grip + move forwards: run',
					'Right grip: hold to talk to SARA, release to send',
					'Either trigger: select a highlighted control',
					'A: open or close controls · B: flashlight · Y: SWIR'
				]
			};
		}
		if (vrPage === 'mission') {
			if (ares02) return { title: 'ARES-02 · Nightfall Protocol', items: [...getMissionControls(), back] };
			return { title: 'ARES-01 · The Last Sample', items: [...getMissionControls(), back] };
		}

		if (!mission && !nightfall && !ares02 && (vrPage === 'sol' || vrPage === 'time')) {
			const editingSol = vrPage === 'sol';
			const limit = editingSol ? 5 : 4;
			const digits = vrDigits.padEnd(limit, '–');
			const hours = Number(vrDigits.slice(0, 2));
			const minutes = Number(vrDigits.slice(2));
			const valid = editingSol ? !!vrDigits : vrDigits.length === 4 && hours < 24 && minutes < 60;
			return {
				title: editingSol ? 'Sol · ' + digits : 'LMST · ' + digits.slice(0, 2) + ':' + digits.slice(2),
				items: [
					...Array.from('1234567890', (digit) => ({
						id: digit, label: digit, disabled: vrDigits.length >= limit,
						run: () => { vrDigits += digit; }
					})),
					{ id: 'erase', label: 'Erase', disabled: !vrDigits, run: () => { vrDigits = vrDigits.slice(0, -1); } },
					{ id: 'save', label: 'Apply', disabled: !valid, run: () => {
						if (editingSol) setClock(Number(vrDigits), clock);
						else setClock(sol, vrDigits.slice(0, 2) + ':' + vrDigits.slice(2));
						vrPage = 'scene';
					} }
				],
				hint: editingSol ? 'Enter a sol (0–99999)  ·  A: close' : 'Enter 24-hour time (HHMM)  ·  A: close'
			};
		}

		if (!mission && !nightfall && !ares02 && vrPage === 'scene') {
			const layers: Array<[TerrainDisplayMode, string]> = [
				['visible', 'Relief'], ['danger', 'Danger calculation'], ['swir', 'Infrared simulation']
			];
			return { title: 'Scene controls', items: [
				...layers.map(([mode, label]) => ({
					id: mode, label, active: displayMode === mode,
					run: () => mode === 'swir' ? toggleSwir() : selectDisplayMode(mode)
				})),
				{ id: 'storm', label: 'Dust storm', active: storm, run: () => { storm = !storm; } },
				{ id: 'sol', label: 'Sol · ' + sol, run: () => { vrDigits = ''; vrPage = 'sol'; } },
				{ id: 'time', label: 'LMST · ' + clock, run: () => { vrDigits = ''; vrPage = 'time'; } },
				{ id: 'live', label: 'Return to current time', run: resetClock }, back
			] };
		}

		const missionItems = getMissionControls();
		const actions = missionItems.filter((item) => item.close && item.id !== 'pause');
		return { title: 'Jezero · Astronaut visor', items: [
			...actions,
			ares01 || ares02
				? { id: 'mission', label: 'Mission controls', run: () => { vrPage = 'mission'; } }
				: { id: 'missions', label: 'Missions', run: () => { vrPage = 'missions'; } },
			{ id: 'settings', label: 'Visor settings', run: () => { vrPage = 'settings'; } },
			{ id: 'close', label: 'Return to visor', close: true, run: () => {} }
		] };
	}

	async function toggleVR() {
		const xr = navigator.xr;
		const scene = terrain;
		if (!xr || !scene || vrBusy) return;
		vrBusy = true;
		vrError = '';
		try {
			if (inVR) {
				await scene.exitVR();
			} else {
				if (!vrAudioPrepared && assistant) {
					preparingVrAudio = true;
					unlockFailed = false;
					try {
						missionVoice?.unlock();
						await assistant.unlock();
					} catch {
						unlockFailed = true;
					} finally {
						preparingVrAudio = false;
						vrAudioPrepared = true;
					}
					if (terrain !== scene) return;
					if (micUnavailable || unlockFailed) {
						vrAudioNotice = 'SARA is unavailable. Check the site’s microphone permission or select Enter VR to continue.';
						return;
					}
					// Answering the mic prompt can outlast the activation required by WebXR.
					if (!navigator.userActivation?.isActive) {
						vrAudioNotice = 'Microphone ready. Select Enter VR to continue.';
						return;
					}
				}
				vrAudioNotice = '';
				vrPage = 'main';
				await scene.enterVR(xr, {
					onEnd: () => {
						inVR = false;
						vrAudioPrepared = false;
					},
					onTalkStart: () => { void voiceDown('vr'); },
					onTalkEnd: () => { if (voiceInput === 'vr') voiceUp(); },
					onToggleSwir: () => { if (!mission && !nightfall && !ares02) toggleSwir(); },
					onToggleFlashlight: toggleFlashlight,
					onMenuOpen: () => { vrPage = 'main'; },
					getMenu: getVrMenu,
					getMissionScreen: () => missionScreen
				});
				inVR = scene.isInVR();
			}
		} catch (cause) {
			console.error('[WebXR]', cause);
			vrError = 'Could not switch VR mode. Try again.';
		} finally {
			vrBusy = false;
		}
	}

	function onKeyDown(event: KeyboardEvent) {
		void clockShortcut(event);
		const target = event.target instanceof Element ? event.target : null;
		const onMic = !!target?.closest('.voice-control');
		const code = event.code;
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
			(code !== 'Space' && !(code === 'Enter' && onMic)) ||
			(!onMic && target?.closest('button, input, select, textarea, a, [contenteditable]'))) return;
		event.preventDefault();
		if (!event.repeat) void voiceDown(code);
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.code !== voiceInput) return;
		event.preventDefault();
		voiceUp();
	}

	async function clockShortcut(event: KeyboardEvent) {
		if (event.defaultPrevented ||
			(event.code === 'Escape' && document.querySelector('.mission-controls [aria-expanded="true"]'))) return;
		if (event.code === 'Escape' && controlsVisible) {
			controlsVisible = false;
			canvas.focus();
			return;
		}
		if (event.code === 'Escape' && missionsOpen) {
			missionsOpen = false;
			return;
		}
		if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
			(event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]'))) return;
		if (event.code === 'KeyF') {
			event.preventDefault();
			toggleFlashlight();
			return;
		}
		if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.code === 'Minus' || event.code === 'NumpadSubtract') {
			event.preventDefault();
			mapZoom = clampMapZoom(mapZoom + (event.code === 'Equal' || event.code === 'NumpadAdd' ? BUTTON_ZOOM_STEP : -BUTTON_ZOOM_STEP));
			terrain?.setMapZoom(mapZoom);
			return;
		}
if (mission || nightfall || ares02) return;
		if (event.code === 'KeyI' && !ares01) {
			event.preventDefault();
			selectDisplayMode(displayMode === 'swir' ? previousDisplayMode : 'swir');
			return;
		}
		if (event.code !== 'KeyH') return;
		event.preventDefault();
		controlsVisible = !controlsVisible;
		if (controlsVisible) {
			if (document.pointerLockElement === canvas) document.exitPointerLock();
			await tick();
			if (controlsVisible) controlsButton?.focus();
		} else {
			canvas.focus();
		}
	}

	function selectDisplayMode(mode: TerrainDisplayMode) {
		if (mode !== 'swir') previousDisplayMode = mode;
		displayMode = mode;
	}

	function setClock(day: number, time: string) {
		if (!Number.isInteger(day) || day < 0 || day > 99999 || !time) return;
		const [hours, minutes] = time.split(':').map(Number);
		selectedSol = day + (hours * 60 + minutes) / 1440;
	}

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
		sceneQuery = location.search;
		const request = new AbortController();
		const params = new URLSearchParams(location.search);
		const useBrowserVoice = params.get('tts') === 'browser';
		void navigator.xr?.isSessionSupported('immersive-vr').then((supported) => {
			if (!request.signal.aborted) vrSupported = supported;
		}).catch(() => {});
		if (ares01 || ares02) missionVoice = createMissionVoice(useBrowserVoice);
		const sara = createAssistant({
			mode: params.get('mode') === 'scripted' ? 'scripted' : 'live',
			tts: useBrowserVoice ? 'browser' : 'elevenlabs',
			cuePolling: params.get('remote') === '1'
		});
		assistant = sara;
		sara.setPlacesProvider(() => {
			const position = terrain?.getPosition();
			if (!position) return null;
			if (!ares02) return placesFrom(position, { rover: ROVER, sample: SAMPLE, base: BASE });
			const parked = nightfall?.terrain.parkedRover;
			return placesFrom(position, parked ? { bravo, rover: parked } : { bravo });
		});
		// Sara's visor controls by voice. The map shares mapZoom with the Map +/− buttons and keys, but each voice
		// command zooms ×4 (VOICE_ZOOM_FACTOR) instead of ±0.5. Infrared follows the visor's own rule: free
		// exploration only (same condition as the I key and the Y button).
		const infraredAvailable = () => !mission && !nightfall && !ares02 && !ares01;
		// Danger layer: same rule as its Relief / Danger / Infrared buttons (free exploration and ARES-01 before start).
		const dangerAvailable = () => !mission && !nightfall && !ares02;
		sara.setVisorStateProvider(() => ({
			map_zoom: mapZoom, map_min_zoom: MAP_MIN_ZOOM, map_max_zoom: MAP_MAX_ZOOM,
			infrared_on: displayMode === 'swir', infrared_available: infraredAvailable(),
			danger_on: displayMode === 'danger', danger_available: dangerAvailable(),
			danger_risk: displayMode === 'danger' ? dangerRisk : null
		}));
		const unsubscribeAction = sara.onAction((action) => {
			if (action.type === 'map_zoom') {
				mapZoom = voiceMapZoom(mapZoom, action.action, action.level);
				terrain?.setMapZoom(mapZoom);
			} else if (action.type === 'infrared' && infraredAvailable()) {
				if (action.on && displayMode !== 'swir') selectDisplayMode('swir');
				else if (!action.on && displayMode === 'swir') selectDisplayMode(previousDisplayMode);
			} else if (action.type === 'danger_layer' && dangerAvailable()) {
				if (action.on && displayMode !== 'danger') selectDisplayMode('danger');
				else if (!action.on && displayMode === 'danger') selectDisplayMode('visible');
			}
		});
		voice = sara.getState();
		const unsubscribeVoice = sara.onState((state) => { voice = state; flushMissionLine(); terrain?.refresh(); });
		now = Date.now();
		const clockTimer = setInterval(() => { now = Date.now(); }, 5000);
		async function load() {
			try {
				const response = await fetch(asset('terrain/jezero.bin'), { signal: request.signal });
				if (!response.ok) throw new Error('Could not download the HiRISE elevation grid.');
				const data = await response.arrayBuffer();
				if (request.signal.aborted) return;
				let geology: GeologyData | undefined;
				try {
					const geologyResponse = await fetch(asset('terrain/jezero-geology.json'), { signal: request.signal });
					if (geologyResponse.ok) {
						const candidate = await geologyResponse.json() as GeologyData;
						if (Array.isArray(candidate.features)) geology = candidate;
					}
				} catch {
					// Terrain and DTM-derived slope remain available without the geology data.
				}
				if (request.signal.aborted) return;
				if (request.signal.aborted) return;
				terrain = mountTerrain(canvas, map, data, asset('terrain/jezero-ortho.webp'), geology, showNotice,
					() => current.text,
					() => nightfall ? `ARES-02 · ${missionClock} · ${nightfall.localTime}${nightfall.paused ? " · PAUSED" : ""}` : mission ? `ARES-01 · ${missionClock}${mission.paused ? ' · PAUSED' : ''}` : `SOL ${sol} · ${clock} LMST`,
					() => hudMessage, () => ({ active: displayMode === 'swir' }),
					() => ({ o2Percent: voice?.telemetry.o2_remaining_pct ?? 96, airTempC: voice?.telemetry.air_temp_c ?? null }),
					(level) => assistant?.setExertion(level),
					ares02 ? createNightfallScene : ares01 ? createMissionScene : undefined);
				showNotice('ready');
				if (!ares02 && matchMedia('(pointer: fine) and (min-width: 900px)').matches) {
					void terrain.loadHighQuality(asset('terrain/jezero-high.bin'), asset('terrain/jezero-ortho-high.webp'));
				}
			} catch (cause) {
				if (request.signal.aborted) return;
				console.error(cause);
				showNotice('error');
			}
		}
		void load();
		return () => {
			request.abort();
			assistant = undefined;
			unsubscribeVoice();
			unsubscribeAction();
			sara.dispose();
			missionVoice?.dispose();
			clearInterval(clockTimer);
			clearTimeout(noticeTimer);
			terrain?.dispose();
			terrain = undefined;
		};
	});
</script>

<svelte:head>
	<title>{ares02 ? 'ARES-02 · Nightfall Protocol' : 'Jezero | Astronaut visor'}</title>
	<meta name="description" content="Explore Jezero's western delta on foot through an astronaut visor." />
</svelte:head>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={voiceUp} />

<main class="visor" bind:this={visor} class:immersive={inVR}>
	<canvas class="terrain" bind:this={canvas} tabindex="0" inert={!!missionScreen && !inVR}
		aria-label="First-person view of Jezero's western delta"
		aria-describedby="scene-input"></canvas>
	<p class="sr-only" id="scene-input">Click the scene or press Enter to capture the pointer.
		Use WASD to walk or drive, the mouse or arrow keys to look, and Escape to release the pointer.
		Press Shift while moving forward to run on foot, F to toggle the flashlight, and H to open scene controls.
		Hold Space to speak English to SARA and release to send. SARA always replies in English.</p>

	<div class="projected">
		<div class="sr-only" role="status" aria-atomic="true">
			{hudMessage.title}{#if nightfall?.message.detail} · {nightfall.message.detail}{/if}{#if mission?.jump} · {mission.jump}{/if}
		</div>
		{#if mission?.walking && !mission.positionLost}
			<p class="sr-only">Distance to rover {mission.remaining} m</p>
		{/if}
		<div class="notice" class:sr-only={!current.text || !!terrain} data-kind={current.kind}>
			<span class="notice-mark" aria-hidden="true"></span>
			<span class="notice-words" role="status" aria-live="polite">
				<span class="t-text-swap" class:is-exit={exited} bind:this={messageText}>
					{#if current.text}<span class="sr-only">{current.label}. </span>{current.text}{/if}
				</span>
			</span>
		</div>

		{#if notice === 'error'}
			<p class="error-help">Check that your browser supports WebGL 2, then reload.</p>
		{/if}

		{#if displayMode === 'swir' && !mission && !nightfall && !ares02}
			<div class="swir-reticle" aria-hidden="true"></div>
		{/if}

		<div class="instruments sr-only" hidden={!terrain}>
			<figure class="radar">
				<div class="map-face" role="img" aria-label="Local terrain map with your position in the centre and an arrow showing your heading">
					<canvas bind:this={map} width="192" height="192" aria-hidden="true"></canvas>
				</div>
			</figure>

			<dl class="readouts" aria-label="Simulated telemetry">
				{#if nightfall}
					{#each nightfall.message.readouts ?? [] as readout}
						<dt>{readout.unit || 'Battery A'}</dt><dd>{readout.value}</dd>
					{/each}
				{:else}
					<dt class="sr-only">Oxygen</dt>
					<dd>{(voice?.telemetry.o2_remaining_pct ?? 96).toFixed(1)}<span>% O₂</span></dd>
					<dt class="sr-only">Temperature</dt>
					<dd>{voice?.telemetry.air_temp_c == null ? '—' : Math.round(voice.telemetry.air_temp_c)}<span>°C</span></dd>
				{/if}
			</dl>
		</div>

		<div class="visor-controls">
			{#if vrError}<p class="vr-error" role="alert">{vrError}</p>{/if}
			{#if vrAudioNotice}<p class="vr-error" role="status">{vrAudioNotice}</p>{/if}
			{#if ares02}
				<Ares02 bind:this={nightfallControls} immersive={inVR} ready={!!terrain} onview={(view) => { nightfall = view; }}
					ondialogue={playNightfallDialogue} onstart={startMission} onpause={pauseMission}
					getPosition={() => terrain?.getPosition()} getHeading={() => terrain?.getHeading()}
					focusScene={() => canvas.focus()} />
				<a class="hud-action" href={resolve('/') + sceneQuery}>Free exploration</a>
			{:else if ares01}
			<Ares01 bind:this={aresControls} immersive={inVR} ready={!!terrain} onview={(view) => {
				mission = view;
			}} ondialogue={playMissionDialogue}
				onstart={startMission}
				onpause={pauseMission}
				getPosition={() => terrain?.getPosition()}
				focusScene={() => canvas.focus()} />
			<a class="hud-action" href={resolve('/') + sceneQuery}>Free exploration</a>
			{/if}
			{#if vrSupported}
				<button type="button" class="hud-action visor-exit" aria-label={inVR ? 'Exit VR' : undefined} disabled={!terrain || vrBusy} onclick={toggleVR}>
					{#if inVR}<VisorIcon name="exit" />{:else if preparingVrAudio}Allow microphone…{:else if vrBusy}Entering VR…{:else}Enter VR{/if}
				</button>
			{/if}
			{#if inVR}
				<div class="visor-map-controls">
					<button type="button" class="hud-action" aria-label="Zoom in on minimap" disabled={!terrain || mapZoom >= MAP_MAX_ZOOM}
						onclick={() => changeMapZoom(BUTTON_ZOOM_STEP)}><VisorIcon name="plus" /></button>
					<button type="button" class="hud-action" aria-label="Zoom out on minimap" disabled={!terrain || mapZoom <= MAP_MIN_ZOOM}
						onclick={() => changeMapZoom(-BUTTON_ZOOM_STEP)}><VisorIcon name="minus" /></button>
				</div>
			{/if}
			<div class="visor-suit-controls">
				<button type="button" class="hud-action" aria-label="Flashlight" aria-pressed={flashlightOn} aria-keyshortcuts="F"
					disabled={!terrain} onclick={toggleFlashlight}>
					{#if inVR}<VisorIcon name="flashlight" />{:else}{flashlightOn ? 'Flashlight on' : 'Flashlight'}{/if} <kbd>{inVR ? 'B' : 'F'}</kbd>
				</button>
				<button type="button" class="hud-action voice-control"
						aria-label="SARA. Hold to talk and release to send"
						aria-keyshortcuts="Space"
						data-recording={voiceStatus === 'recording'}
						onpointerdown={(event) => {
							if (event.button !== 0 || !event.isPrimary) return;
							event.currentTarget.setPointerCapture(event.pointerId);
							void voiceDown('pointer');
						}}
						onpointerup={() => { if (voiceInput === 'pointer') voiceUp(); }}
						onlostpointercapture={() => { if (voiceInput === 'pointer') voiceUp(); }}>
						<VisorIcon name="mic" />
						<span>SARA</span><kbd>{inVR ? 'Hold grip' : 'Space'}</kbd>
						{#if !inVR}<span class="touch-hint" aria-hidden="true">Hold</span>{/if}
					</button>
			</div>
		</div>
	</div>

	{#if briefing && missionScreen && !inVR}
		{#key missionScreen}
			<MissionScreen
				mission={briefing.id + ' · ' + (missionComplete ? briefing.title : 'Mission briefing')}
				title={missionComplete ? 'Mission complete' : briefing.title}
				paragraphs={missionComplete ? briefing.debrief : briefing.briefing}
				complete={missionComplete} ready={!!terrain} unavailable={notice === 'error'}
				onprimary={() => runMissionScreenAction(missionComplete ? 'restart' : 'start')}
				onback={() => runMissionScreenAction('leave')} />
		{/key}
	{/if}

	{#if !mission && !nightfall && !ares02}
		<div class="mission-switch">
			<button type="button" class="hud-action mission-trigger" aria-expanded={missionsOpen}
				aria-controls="mission-menu" onclick={() => { missionsOpen = !missionsOpen; }}>
				Missions
			</button>
			<div id="mission-menu" class="mission-options mission-menu" data-open={missionsOpen}
				inert={!missionsOpen} aria-hidden={!missionsOpen}>
				<a class="hud-action" href={resolve('/missions/ares01') + sceneQuery}
					onclick={() => { missionsOpen = false; }}>ARES-01 · The Last Sample</a>
				<a class="hud-action" href={resolve('/missions/ares02') + sceneQuery}
					onclick={() => { missionsOpen = false; }}>ARES-02 · Nightfall Protocol</a>
			</div>
		</div>
	{/if}

	{#if !mission && !ares02}
		<div class="scene-controls">
			<section id="scene-controls-panel" class="scene-controls-panel" aria-label="Scene controls"
				hidden={!controlsVisible}>
					<div class="control-section">
						<h2>Mars time</h2>
						<label>Sol (MSD)
							<input name="sol" type="number" min="0" max="99999" step="1" value={sol}
								onchange={(event) => setClock(event.currentTarget.valueAsNumber, clock)} />
						</label>
						<label>Local time (LMST)
							<input name="time" type="time" value={clock}
								onchange={(event) => setClock(sol, event.currentTarget.value)} />
						</label>
						<button type="button" onclick={() => { now = Date.now(); selectedSol = undefined; }}>
							Return to current time
						</button>
					</div>
					<div class="control-section">
						<h2>Atmosphere</h2>
						<button type="button" aria-pressed={storm} onclick={() => { storm = !storm; }}>
							{storm ? 'Storm active' : 'Storm mode'}
						</button>
					</div>
					<div class="control-section">
						<h2>Map</h2>
						<div class="layer-buttons" role="group" aria-label="Minimap zoom">
							<button type="button" aria-keyshortcuts="Plus" disabled={!terrain || mapZoom >= MAP_MAX_ZOOM}
							onclick={() => changeMapZoom(BUTTON_ZOOM_STEP)}>Map +</button>
							<button type="button" aria-keyshortcuts="Minus" disabled={!terrain || mapZoom <= MAP_MIN_ZOOM}
							onclick={() => changeMapZoom(-BUTTON_ZOOM_STEP)}>Map −</button>
						</div>
					</div>
					<div class="control-section">
						<h2>Terrain layer</h2>
						<div class="layer-buttons" role="group" aria-label="Choose a terrain view">
							<button type="button" aria-pressed={displayMode === 'visible'} onclick={() => selectDisplayMode('visible')}>Relief</button>
							<button type="button" aria-pressed={displayMode === 'danger'}
								onclick={() => selectDisplayMode('danger')}>Danger calculation</button>
							<button type="button" aria-pressed={displayMode === 'swir'} aria-keyshortcuts={ares01 ? undefined : "I"}
								onclick={() => selectDisplayMode(displayMode === 'swir' ? previousDisplayMode : 'swir')}>Infrared simulation{ares01 ? "" : " · I"}</button>
						</div>
						<p class="layer-caption">
							{#if displayMode === 'danger'}Risk: soil consistency (SIM 3464 × HiRISE) · slope · relief · ground temp · dust
								<span class="danger-readout" aria-live="polite">Current position: {Math.round(dangerRisk * 100)}% · {dangerRisk >= 0.66 ? 'High' : dangerRisk >= 0.33 ? 'Moderate' : 'Low'}</span>
							{:else if displayMode === 'swir'}SIMULATED · 1.65 µm · dust-transparent
							{:else}HiRISE orthophoto + relief{/if}
			{#if displayMode !== 'swir'}<br /><span class="eolian-legend"><i aria-hidden="true"></i>Aeb sand · magenta hatch on map · slow movement</span>{/if}
						</p>
					</div>
			</section>
			<button type="button" class="scene-controls-trigger" bind:this={controlsButton}
				aria-expanded={controlsVisible} aria-controls="scene-controls-panel" aria-keyshortcuts="H"
				onclick={() => { controlsVisible = !controlsVisible; }}>
				{#if inVR}<VisorIcon name="settings" />{/if} Controls{#if !inVR} <kbd>H</kbd>{/if}
			</button>
		</div>
	{/if}
</main>
