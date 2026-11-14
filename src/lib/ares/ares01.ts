import { BASE, DETOUR, DIRECT, pointAlong, ROVER, SAMPLE, SAMPLING_KIT } from './route.js';

export const DURATION = 210;
export const SOURCE = 'SIMULATED · ARES-01 script';
export const SAMPLE_STATUS = 'not_collected';

// Fixture readings for the scripted check, in kPa. The 9 s window is a demo assumption.
const pressureReadings = [30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0];
const pressureCheckStart = 113;

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
	{ at: 65, id: 'return', state: 'RETURN_EVA', title: 'Return on foot', text: 'The rover is 350 metres away. Follow the marked corridor and prioritize a safe return.' },
	{ at: 90, id: 'hazard', state: 'HAZARD_DETECTED', title: 'Unstable slope', text: 'Stop. The planned corridor crosses a slope covered in loose regolith, increasing the risk of a fall.' },
	{ at: 93, id: 'reroute', state: 'REROUTE', title: 'Recommended detour · +65 m', text: 'A surveyed alternate corridor avoids unstable ground and adds 65 metres.' },
	{ at: 100, id: 'reroute-accepted', state: 'REROUTE', title: 'Detour active', text: 'Route updated. Follow the alternate corridor to the waypoint.' },
	{ at: 108, id: 'trip', state: 'SUIT_DIAGNOSTIC', title: 'Loss of balance', text: 'A loose rock shifts under your boot as you take the detour.' },
	{ at: 111, id: 'impact', state: 'SUIT_DIAGNOSTIC', title: 'Rock impact', text: 'The suit scrapes a rock edge. Stop moving.' },
	{ at: 113, id: 'pressure-check', state: 'SUIT_DIAGNOSTIC', title: 'SUIT INTEGRITY CHECK', text: 'The integrity sensor detected an anomaly. Checking the internal pressure trend.' },
	{ at: 117, id: 'outer-damage', state: 'SUIT_DIAGNOSTIC', title: 'Possible outer-layer damage', text: 'The outer layer may be damaged. I am still checking pressure.' },
	{ at: 122, id: 'pressure-stable', state: 'SUIT_DIAGNOSTIC', title: 'Internal pressure stable', text: 'No leak detected during the pressure check. Surface damage is possible. Limit movement in the affected area and proceed with caution.' },
	{ at: 125, id: 'position', state: 'LOCALIZATION_CHECK', title: 'Position confirmed', text: 'Inertial navigation and rover references agree within the simulation tolerance. The rover is 90 metres away.' },
	{ at: 149, id: 'approach', state: 'RETURN_EVA', title: 'Approaching the rover', text: 'Vehicle references confirmed. Continue toward the airlock.' },
	{ at: 155, id: 'shelter', state: 'ROVER_SHELTER', title: 'Rover pressurized · EVA complete', text: 'Entry complete. Pressurization confirmed.' },
	{ at: 180, id: 'base-return', state: 'BASE_RETURN', title: 'Return to base · 2.4 km', text: 'Return route loaded. Drive slowly along the surveyed route.' },
	{ at: 210, id: 'closed', state: 'MISSION_CLOSED', title: 'Base reached · crew safe', text: 'Deteriorating weather interrupted drilling. The photographs, location and progress are saved for a future attempt.' }
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

	const walking = second >= 65 && second < 155;
	const pressure = pressureAt(second - pressureCheckStart);
	const detour = second >= 100;
	const remaining = time < 90 ? 350 - Math.max(0, time - 65) * 1.4
		: time < 100 ? 315
		: time < 125 ? 380 - Math.min(8, time - 100) * 1.4
		: time < 149 ? 90 - (time - 125) * 1.4
		: time < 155 ? (155 - time) * 1.4 : 0;
	const route = detour ? DETOUR : DIRECT;
	const distance = (detour ? 415 : 350) - remaining;
	const point = second >= 210 ? BASE : second >= 155 ? ROVER : pointAlong(route, distance);
	const ahead = walking && remaining <= 2 ? { x: ROVER.x, z: ROVER.z + 2 }
		: walking ? pointAlong(route, distance + 2) : second < 65
		? SAMPLING_KIT
		: BASE;
	const dust = dustAt(time);
	const navigation = positionLost ? 'References unavailable' : second < 20 ? 'Nominal' : second < 125 ? 'Degraded' : 'Confirmed';
	const jump = second >= 125 && second < 131 ? '+ several minutes of walking'
		: second >= 149 && second < 153 ? '+ final stretch on foot'
		: second >= 205 && second < 210 ? '+ 2.4 km rover drive' : '';

	return {
		cue, point, ahead, route, remaining: Math.round(remaining), dust, navigation, jump, detour, walking,
		pressure,
		critical: positionLost || (second >= 40 && second < 65 && choice !== 'return'),
		sheltered: second >= 155 && second < 210,
		sample: SAMPLE_STATUS as typeof SAMPLE_STATUS,
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
			distanceToRoverM: snapshot.positionLost || snapshot.sheltered || snapshot.cue.id === 'closed' ? null : snapshot.remaining
		}
	};
}
