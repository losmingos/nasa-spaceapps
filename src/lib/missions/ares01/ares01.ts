import { BASE, DETOUR, DETOUR_EXTRA, DETOUR_CLEAR_DISTANCE, DIRECT, DIRECT_DISTANCE, distanceBetween, pointAlong, ROVER, SAMPLE, SAMPLING_KIT } from './route.js';

export const DURATION = 178;
export const SHELTER_AT = 123;
export const HAZARD_AT = 75;
export const SOURCE = 'SIMULATED · ARES-01 script';
export const SAMPLE_STATUS = 'not_collected';

// Fixture readings for the scripted check, in kPa. The 9 s window is a demo assumption.
const pressureReadings = [30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0];
export const TRIP_AT = 89;
export const PRESSURE_STABLE_AT = 103;
const pressureCheckStart = 94;

export const bitacora = {
	site: 'Fictional terrace on the western delta',
	strata: 'Strata photographed during the survey',
	progress: 'Drilling interrupted before core extraction',
	position: SAMPLE
};

export interface Cue {
	at: number;
	id: string;
	state: string;
	title: string;
	text: string;
}

const cues: readonly Cue[] = [
	{ at: 0, id: 'sample', state: 'SAMPLING', title: 'Core extraction', text: 'Target located. The sedimentary deposit is consistent with an ancient lakebed. About ten minutes of drilling remain.' },
	{ at: 20, id: 'advisory', state: 'WEATHER_ADVISORY', title: 'Dust advisory', text: 'Dust is intensifying faster than expected. I recommend aborting sampling and returning to the rover. Do you want to continue?' },
	{ at: 40, id: 'abort', state: 'EVA_ABORT', title: 'EVA ABORT — RETURN REQUIRED', text: 'Critical alert. Loss of visibility and terrain references is compromising the return. Abort sampling and return to the rover.' },
	{ at: 44, id: 'prepare', state: 'RETURN_PREP', title: 'Secure the equipment', text: 'Drilling needs ten more minutes. The margin for a safe return is too small. Stop the drill and log your location and progress.' },
	{ at: 65, id: 'return', state: 'RETURN_EVA', title: 'Return on foot', text: `Survey samples secured. The rover is ${DIRECT_DISTANCE} metres away. Follow the marked corridor.` },
	{ at: HAZARD_AT, id: 'hazard', state: 'HAZARD_DETECTED', title: 'Unstable slope', text: 'Stop. A large boulder blocks the planned corridor across the unstable slope.' },
	{ at: 78, id: 'reroute', state: 'REROUTE', title: `Recommended detour · +${DETOUR_EXTRA} m`, text: `A surveyed alternate corridor avoids unstable ground and adds ${DETOUR_EXTRA} metres.` },
	{ at: 82, id: 'reroute-accepted', state: 'REROUTE', title: 'Detour active', text: 'Route updated. Follow the alternate corridor to the waypoint.' },
	{ at: TRIP_AT, id: 'trip', state: 'SUIT_DIAGNOSTIC', title: 'Loss of balance', text: 'You lose your balance just after clearing the boulder.' },
	{ at: 92, id: 'impact', state: 'SUIT_DIAGNOSTIC', title: 'Suit impact', text: 'You hit the ground. Stop moving.' },
	{ at: pressureCheckStart, id: 'pressure-check', state: 'SUIT_DIAGNOSTIC', title: 'SUIT INTEGRITY CHECK', text: 'The integrity sensor detected an anomaly. Checking the internal pressure trend.' },
	{ at: 98, id: 'outer-damage', state: 'SUIT_DIAGNOSTIC', title: 'Possible outer-layer damage', text: 'The outer layer may be damaged. I am still checking pressure.' },
	{ at: PRESSURE_STABLE_AT, id: 'pressure-stable', state: 'SUIT_DIAGNOSTIC', title: 'Internal pressure stable', text: 'No leak detected during the pressure check. Surface damage is possible. Limit movement in the affected area and proceed with caution.' },
	{ at: 106, id: 'position', state: 'LOCALIZATION_CHECK', title: 'Position confirmed', text: 'Inertial navigation and rover references agree within the simulation tolerance. The rover is 18 metres away.' },
	{ at: 118, id: 'approach', state: 'RETURN_EVA', title: 'Approaching the rover', text: 'Vehicle references confirmed. Continue toward the airlock.' },
	{ at: SHELTER_AT, id: 'shelter', state: 'ROVER_SHELTER', title: 'Rover pressurized · EVA complete', text: 'Entry complete. Pressurization confirmed.' },
	{ at: 148, id: 'base-return', state: 'BASE_RETURN', title: 'Return to base · 2.4 km', text: 'Return route loaded. Drive slowly along the surveyed route.' },
	{ at: DURATION, id: 'closed', state: 'MISSION_CLOSED', title: 'Base reached · crew safe', text: 'Deteriorating weather interrupted drilling. The photographs, location and progress are saved for a future attempt.' }
];

const hold: Cue = { at: 0, id: 'position-lost', state: 'LOCALIZATION_CHECK', title: 'Stop · position unconfirmed', text: 'Stop moving. The navigation system lost its references. Request a fresh position fix from the rover.' };
const earlyReturn: Cue = { at: 20, id: 'early-return', state: 'RETURN_PREP', title: 'Precautionary return', text: 'Sampling stopped. Secure the drill and log your progress before leaving.' };
const continued: Cue = { at: 25, id: 'continue', state: 'CONTINUE_WITH_WARNING', title: 'Sampling under advisory', text: 'Understood. I will keep monitoring. The safety margin is shrinking.' };

export function pressureAt(seconds: number) {
	if (seconds < 0) return 'Nominal';
	const window = pressureReadings.slice(0, Math.floor(seconds) + 1);
	if (window.length < pressureReadings.length) return 'Checking pressure trend';
	return window.every((reading) => reading === window[0])
		? 'Stable · no leak detected' : 'Pressure variation · review required';
}

export function dustAt(seconds: number) {
	return Math.min(1, Math.max(0, (seconds - 17) / 30));
}

export function missionAt(time: number, choice?: 'continue' | 'return', positionLost = false) {
	const second = Math.floor(time);
	let cue = cues.findLast(({ at }) => at <= second) ?? cues[0];
	if (choice === 'return' && second >= 20 && second < 65) cue = earlyReturn;
	if (choice === 'continue' && second >= 20 && second < 40) cue = continued;
	if (positionLost) cue = hold;

	const walking = second >= 65 && second < SHELTER_AT;
	const pressure = pressureAt(second - pressureCheckStart);
	const detour = second >= 82;
	const route = detour ? DETOUR : DIRECT;
	const routeLength = DIRECT_DISTANCE + (detour ? DETOUR_EXTRA : 0);
	const junctionDistance = distanceBetween(SAMPLE, DIRECT[1]);
	const distance = time < HAZARD_AT ? junctionDistance * Math.max(0, time - 65) / (HAZARD_AT - 65)
		: time < 82 ? junctionDistance
		: time < 106 ? junctionDistance + (DETOUR_CLEAR_DISTANCE - junctionDistance) * Math.min(1, (time - 82) / (TRIP_AT - 82))
		: routeLength - 18 * Math.max(0, SHELTER_AT - time) / (SHELTER_AT - 106);
	const remaining = routeLength - distance;
	const point = second >= DURATION ? BASE : second >= SHELTER_AT ? ROVER : pointAlong(route, distance);
	const ahead = walking && remaining <= 2 ? { x: ROVER.x, z: ROVER.z + 2 }
		: walking ? pointAlong(route, distance + 2) : second < 65
		? SAMPLING_KIT
		: BASE;
	const dust = dustAt(time);
	const navigation = positionLost ? 'References unavailable' : second < 20 ? 'Nominal' : second < 106 ? 'Degraded' : 'Confirmed';
	const jump = second >= 106 && second < 110 ? '+ along the detour'
		: second >= 118 && second < 121 ? '+ final stretch on foot'
		: second >= DURATION - 5 && second < DURATION ? '+ 2.4 km rover drive' : '';

	return {
		cue, point, ahead, route, remaining: Math.round(remaining), dust, navigation, jump, detour, walking,
		pressure,
		critical: positionLost || (second >= 40 && second < 65 && choice !== 'return'),
		sheltered: second >= SHELTER_AT && second < DURATION,
		sample: SAMPLE_STATUS as typeof SAMPLE_STATUS,
		samplesCollected: second >= 65,
		log: second >= 65 ? bitacora : null,
		positionLost
	};
}

export type MissionSnapshot = ReturnType<typeof missionAt>;

/** One notification per dialogue change, ready for the voice client to subscribe. */
export interface Ares01Dialogue {
	scenario: 'ARES-01';
	demoSecond: number;
	id: string;
	speaker: 'jarvis' | 'scene';
	text: string;
	telemetry: {
		source: typeof SOURCE;
		navigation: string;
		pressure: string;
		sample: typeof SAMPLE_STATUS;
		surveySamplesCarried: number;
		distanceToRoverM: number | null;
	};
}

export function dialogueAt(time: number, snapshot: MissionSnapshot): Ares01Dialogue {
	return {
		scenario: 'ARES-01',
		demoSecond: Math.floor(time),
		id: snapshot.cue.id,
		speaker: ['trip', 'impact'].includes(snapshot.cue.id) ? 'scene' : 'jarvis',
		text: snapshot.cue.text,
		telemetry: {
			source: SOURCE,
			navigation: snapshot.navigation,
			pressure: snapshot.pressure,
			sample: snapshot.sample,
			surveySamplesCarried: snapshot.samplesCollected ? 3 : 0,
			distanceToRoverM: snapshot.positionLost || snapshot.sheltered || snapshot.cue.id === 'closed' ? null : snapshot.remaining
		}
	};
}
