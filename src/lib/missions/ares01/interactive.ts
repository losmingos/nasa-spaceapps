import { BASE, DETOUR, DIRECT, distanceBetween, LOOSE_ROCK, pointAlong, ROVER, SAMPLE, type Point } from './route.js';
import { bitacora, dustAt, pressureAt, SAMPLE_STATUS, type Cue, type MissionSnapshot } from './ares01.js';

type Phase = 'site' | 'sampling' | 'advisory' | 'continue' | 'abort' | 'secure'
	| 'collect' | 'junction' | 'hazard' | 'detour' | 'impact' | 'check' | 'resume'
	| 'beacon' | 'lost' | 'rover' | 'board' | 'shelter' | 'drive' | 'park' | 'closed';

const messages: Record<Phase, [string, string]> = {
	site: ['Sampling site', 'Approach the equipment and start drilling. About ten minutes of work remain.'],
	sampling: ['Drilling in progress', 'Drilling started. The target is a mudstone core from the Jezero delta.'],
	advisory: ['Dust advisory', 'Dust is intensifying. I recommend stopping the drill and returning to the rover. Do you want to continue?'],
	continue: ['Sampling under advisory', 'Understood. I will keep monitoring. The margin for a safe return is shrinking.'],
	abort: ['Abort EVA', 'Critical alert. Dust is compromising navigation. Stop the drill and return to the rover.'],
	secure: ['Secure the equipment', 'Drill stopped. Secure the equipment and log your progress and location.'],
	collect: ['Collect the samples', 'Pick up the three sealed survey samples before leaving. The main core is still in the rock.'],
	junction: ['Return on foot', 'Three survey samples secured. Log saved. The rover is about 350 metres away. Walk to the first waypoint.'],
	hazard: ['Unstable slope', 'Stop. There is loose regolith on the slope. I recommend the surveyed detour, which adds 65 metres.'],
	detour: ['Detour active', 'Detour loaded. Head east toward the waypoint and proceed with caution.'],
	impact: ['Rock impact', 'You stepped on a loose rock. I detected an impact on the suit. Stop and start the integrity check.'],
	check: ['Checking suit integrity', 'The outer layer may be damaged. I am checking the pressure trend.'],
	resume: ['Pressure stable', 'Pressure is stable. I detect no leak. There may be surface damage, so proceed with caution.'],
	beacon: ['Return to the corridor', 'Continue along the detour and follow the corridor toward the rover.'],
	lost: ['Position unconfirmed', 'Stop. I lost our navigation references in the dust. Request a position fix from the rover beacon.'],
	rover: ['Position confirmed', 'Position confirmed by the beacon and inertial navigation. Continue to the airlock.'],
	board: ['Rover airlock', 'You are at the airlock. Enter the rover and confirm pressurization.'],
	shelter: ['EVA complete', 'Pressurization confirmed. The base is 2.4 kilometres away. Begin driving when ready.'],
	drive: ['Drive to base', 'Route loaded. Keep your speed low and follow the corridor to the base.'],
	park: ['Base entrance', 'You have reached the base entrance. Stop the rover and confirm arrival.'],
	closed: ['Base reached', 'The crew and the three survey samples are safe. The main core remains at the site.']
};

export type MissionAction = 'drill' | 'continue' | 'abort' | 'secure' | 'detour' | 'check'
	| 'collect' | 'resume' | 'locate' | 'board' | 'drive' | 'finish';

export interface InteractiveMission {
	phase: Phase;
	at: number;
	elapsed: number;
	position: Point;
	weatherStarted: number | null;
	detour: boolean;
	logged: boolean;
	samplesCollected: boolean;
}

export const START: Point = { x: SAMPLE.x, z: SAMPLE.z - 5 };
const BEACON = pointAlong(DETOUR, 325);
const targets: Partial<Record<Phase, Point>> = {
	site: SAMPLE,
	junction: DIRECT[1],
	detour: LOOSE_ROCK,
	beacon: DETOUR[3],
	rover: ROVER,
	board: ROVER,
	drive: BASE,
	park: BASE
};
const movingPhases: Phase[] = ['site', 'junction', 'detour', 'beacon', 'rover', 'drive'];
const near = (point: Point, target: Point, radius: number) => distanceBetween(point, target) <= radius;

export function startInteractive(): InteractiveMission {
	return { phase: 'site', at: 0, elapsed: 0, position: START, weatherStarted: null, detour: false, logged: false, samplesCollected: false };
}

function enter(run: InteractiveMission, phase: Phase): InteractiveMission {
	return { ...run, phase, at: run.elapsed };
}

export function stepInteractive(run: InteractiveMission, delta: number, position: Point): InteractiveMission {
	const next = { ...run, elapsed: run.elapsed + delta, position };
	const weather = next.weatherStarted === null ? 0 : next.elapsed - next.weatherStarted;
	switch (next.phase) {
		case 'sampling': return weather >= 20 ? enter(next, 'advisory') : next;
		case 'advisory':
		case 'continue': return weather >= 40 ? enter(next, 'abort') : next;
		case 'junction': return near(position, DIRECT[1], 8) ? enter(next, 'hazard') : next;
		case 'detour': return near(position, LOOSE_ROCK, 7) ? enter(next, 'impact') : next;
		case 'check': return next.elapsed - next.at >= 9 ? enter(next, 'resume') : next;
		case 'beacon':
			return near(position, BEACON, 16) ? enter(next, 'lost') : next;
		case 'rover': return near(position, ROVER, 5) ? enter(next, 'board') : next;
		case 'drive': return near(position, BASE, 12) ? enter(next, 'park') : next;
		default: return next;
	}
}

export function availableActions(run: InteractiveMission): MissionAction[] {
	switch (run.phase) {
		case 'site': return near(run.position, SAMPLE, 4) ? ['drill'] : [];
		case 'advisory': return ['abort', 'continue'];
		case 'continue':
		case 'abort':
		case 'sampling': return ['abort'];
		case 'secure': return ['secure'];
		case 'collect': return ['collect'];
		case 'hazard': return ['detour'];
		case 'impact': return ['check'];
		case 'resume': return ['resume'];
		case 'lost': return ['locate'];
		case 'board': return ['board'];
		case 'shelter': return ['drive'];
		case 'park': return ['finish'];
		default: return [];
	}
}

export function actInteractive(run: InteractiveMission, action: MissionAction): InteractiveMission {
	if (!availableActions(run).includes(action)) return run;
	switch (action) {
		case 'drill': return enter({ ...run, weatherStarted: run.elapsed }, 'sampling');
		case 'continue': return enter(run, 'continue');
		case 'abort': return enter(run, 'secure');
		case 'secure': return enter({ ...run, logged: true }, 'collect');
		case 'collect': return enter({ ...run, samplesCollected: true }, 'junction');
		case 'detour': return enter({ ...run, detour: true }, 'detour');
		case 'check': return enter(run, 'check');
		case 'resume': return enter(run, 'beacon');
		case 'locate': return enter(run, 'rover');
		case 'board': return enter(run, 'shelter');
		case 'drive': return enter(run, 'drive');
		case 'finish': return enter(run, 'closed');
	}
}

const targetNames: Partial<Record<Phase, string>> = {
	site: 'equipment', junction: 'junction', detour: 'detour waypoint', beacon: 'beacon', rover: 'airlock', drive: 'base'
};

export function interactiveSnapshot(run: InteractiveMission) {
	const { phase, position } = run;
	const [title, text] = messages[phase];
	const cue: Cue = { at: run.at, id: phase === 'closed' ? 'closed' : 'play-' + phase, state: phase, title, text };
	const lost = phase === 'lost';
	const driving = phase === 'drive';
	const baseRoute = ['shelter', 'drive', 'park', 'closed'].includes(phase);
	const route = baseRoute ? [ROVER, BASE] : run.detour ? DETOUR : DIRECT;
	const move = movingPhases.includes(phase);
	const target = phase === 'beacon' ? BEACON : targets[phase];
	const heading = target && targetNames[phase] ? targetNames[phase] : undefined;
	const compass = target ? Math.round((Math.atan2(target.x - position.x, position.z - target.z) * 180 / Math.PI + 360) % 360) : 0;
	const remaining = Math.round(distanceBetween(position, baseRoute ? BASE : ROVER));

	const snapshot: MissionSnapshot = {
		cue, point: START, ahead: SAMPLE, route, remaining,
		dust: run.weatherStarted === null ? 0 : dustAt(run.elapsed - run.weatherStarted),
		navigation: lost ? 'References unavailable' : ['rover', 'board'].includes(phase) || baseRoute ? 'Confirmed' : 'Inertial navigation',
		jump: '', detour: run.detour, walking: move && !driving,
		pressure: phase === 'check' ? pressureAt(run.elapsed - run.at)
			: ['resume', 'beacon', 'lost', 'rover', 'board'].includes(phase) || baseRoute ? pressureAt(9) : 'Nominal',
		critical: phase === 'abort' || lost,
		sheltered: baseRoute && phase !== 'closed',
		sample: SAMPLE_STATUS,
		samplesCollected: run.samplesCollected,
		log: run.logged ? bitacora : null,
		positionLost: lost
	};

	return {
		...snapshot, baseRoute, driving, move, target: lost ? undefined : target, heading, compass,
		targetDistance: target && Math.round(distanceBetween(position, target)),
		tilt: phase === 'impact' || phase === 'check' ? 1 : 0,
		showHazard: phase === 'hazard' || (run.detour && !baseRoute)
	};
}
