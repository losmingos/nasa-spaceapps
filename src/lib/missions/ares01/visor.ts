import { asset } from '$app/paths';
import type { VisorMessage } from '../../visor/optics.js';
import type { MissionSnapshot } from './ares01.js';
import type { interactiveSnapshot } from './interactive.js';
import { buildAres01Scene } from './scene.js';
import type { MissionSceneFactory, MissionView } from '../../visor/terrain.js';
import { BASE, HAZARD, HAZARD_RADIUS, ROVER, SAMPLE } from './route.js';

export type Ares01View = MissionSnapshot & {
	time: number;
	paused: boolean;
	player?: ReturnType<typeof interactiveSnapshot> & { run: number; enabled: boolean; speedMultiplier: number };
};

const missionTitles: Record<string, string> = {
	sample: 'Extracting core · ~10 min',
	advisory: 'Dust increasing · return to rover',
	abort: 'Abort sampling · return to rover',
	prepare: 'Secure equipment and save log',
	'early-return': 'Precautionary return',
	return: 'Follow the route to the rover',
	hazard: 'Stop · unstable slope',
	reroute: 'Safe detour · +65 m',
	trip: 'Caution · loss of balance',
	impact: 'Suit impact · stop moving',
	'pressure-check': 'Checking suit pressure',
	'outer-damage': 'Possible outer-layer damage',
	'pressure-stable': 'Pressure stable · proceed with caution',
	'position-lost': 'Stop · position unconfirmed',
	shelter: 'Rover pressurized · EVA complete',
	'base-return': 'Return to base · 2.4 km',
	closed: 'Base reached · crew safe'
};

export function missionMessage(mission: Ares01View): VisorMessage {
	return {
		title: missionTitles[mission.cue.id] ?? mission.cue.title,
		detail: mission.jump || (mission.player?.move && mission.player.heading ? `${mission.player.heading} · ${mission.player.targetDistance} m · ${mission.player.compass}°` : undefined) || (mission.cue.id === 'closed' ? 'Three survey samples recovered · core not collected'
			: mission.walking && !mission.positionLost ? `Rover · ${mission.remaining} m` : undefined),
		kind: mission.critical ? 'danger' : mission.time >= 20 && mission.time < 40 ? 'warning' : undefined
	};
}

export function missionContext(mission: Ares01View) {
	return JSON.stringify({
		scenario: 'ARES-01', state: mission.cue.state, objective: mission.cue.title,
		guidance: mission.cue.text, navigation: mission.navigation, pressure: mission.pressure,
		sample: mission.sample, surveySamplesCarried: mission.samplesCollected ? 3 : 0, logSaved: !!mission.log,
		target: mission.player?.heading,
		distanceToTargetM: mission.positionLost ? null : mission.player?.targetDistance,
		bearingDegrees: mission.positionLost ? null : mission.player?.compass,
		secondsElapsed: mission.time,
		// What the astronaut sees: 0 = clear air, 1 = full dust storm. The dust starts before the advisory cue.
		dust: Math.round((mission.dust ?? 0) * 100) / 100
	});
}

const evaMap = { center: { x: SAMPLE.x + 30, z: SAMPLE.z + 175 }, scale: 5, objective: SAMPLE, vehicle: ROVER };
const baseMap = { center: { x: ROVER.x, z: (ROVER.z + BASE.z) / 2 }, scale: 30, objective: BASE, vehicle: ROVER };
const hazard = { ...HAZARD, radius: HAZARD_RADIUS };

export function missionTerrainView(mission: Ares01View): MissionView {
	const baseRoute = mission.player?.baseRoute ?? mission.time >= 155;
	return {
		point: mission.point,
		ahead: mission.ahead,
		route: mission.player?.route ?? (mission.time >= 155 ? [ROVER, BASE] : mission.route),
		baseRoute,
		inCabin: baseRoute,
		headlamps: baseRoute ? 1 : undefined,
		map: baseRoute ? baseMap : evaMap,
		hazard: (mission.player?.showHazard ?? (mission.time >= 90 && mission.time < 155)) ? hazard : undefined,
		showPosition: !mission.positionLost,
		tilt: mission.player?.tilt ?? (mission.time >= 108 && mission.time < 122 ? 1 : 0),
		samplesCollected: mission.samplesCollected,
		drilling: ['SAMPLING', 'WEATHER_ADVISORY', 'CONTINUE_WITH_WARNING', 'sampling', 'advisory', 'continue', 'abort'].includes(mission.cue.state),
		drillPaused: mission.paused,
		player: mission.player
	};
}

function missionModelUrls() {
	return {
		rover: asset('models/missions/ares01/sev.glb'),
		drill: asset('models/missions/ares01/ares-drill.glb'),
		tube: asset('models/missions/ares01/ares-tube.glb')
	};
}

export const createMissionScene: MissionSceneFactory = (height, refresh, registerSwir) =>
	buildAres01Scene(height, missionModelUrls(), refresh, registerSwir);
