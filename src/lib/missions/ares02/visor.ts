import { distanceBetween } from '../ares01/route.js';
import type { MissionView } from '../../visor/terrain.js';
import type { VisorMessage } from '../../visor/optics.js';
import { directRouteBudget, phases, plannedRouteBudget, reserve, roverSpeedLimitKmh, routeForecast, type Phase } from './ares02.js';
import { actions, driveBudget, goal, moving, onServiceEva, servicePoints, type Action, type Run, type Stage } from './interactive.js';
import { bravo, handoff, plannedRoute, startPoint } from './route.js';

export const labels: Record<Action, string> = {
	lights: 'Switch on headlights', depart: 'Start driving', assess: 'Check battery endurance',
	diagnose: 'Verify isolation', 'suit-check': 'Check suit and secure rover', 'service-exit': 'Cycle airlock and exit',
	'open-panel': 'Open service panel', 'reseat-link': 'Reseat battery A module', 'close-panel': 'Latch service panel',
	reboard: 'Board and repressurize', 'test-bus': 'Test battery A bus', compare: 'Compare routes',
	configure: 'Authorize degraded drive', drive: 'Load direct route and drive',
	park: 'Park at Bravo',
	collect: 'Retrieve the module', exit: 'Exit through the airlock', deliver: 'Deliver the module'
};

const deliveryRoute = [bravo, handoff];
const driveMap = { center: { x: 791, z: -3456 }, scale: 1.65, objective: bravo };

const phasesByStage: Record<Stage, Phase['id']> = {
	preflight: 'NIGHT_TRANSIT', outbound: 'NIGHT_TRANSIT', fault: 'POWER_FAULT', assessment: 'ENERGY_ASSESSMENT',
	diagnostic: 'ISOLATION_TEST', verified: 'ISOLATION_TEST', 'eva-prep': 'ISOLATION_TEST', 'service-walk': 'ISOLATION_TEST',
	'panel-closed': 'ISOLATION_TEST', 'panel-open': 'ISOLATION_TEST', 'link-seated': 'ISOLATION_TEST',
	'return-airlock': 'ISOLATION_TEST', airlock: 'ISOLATION_TEST', 'bus-check': 'DEGRADED_DRIVE_READY', 'bus-verified': 'DEGRADED_DRIVE_READY', options: 'ROUTE_OPTIMIZATION',
	configured: 'DEGRADED_DRIVE_READY', drive: 'DEGRADED_TRANSIT',
	park: 'DEGRADED_TRANSIT', cargo: 'DEGRADED_TRANSIT',
	egress: 'DEGRADED_TRANSIT', walk: 'DEGRADED_TRANSIT', handoff: 'DEGRADED_TRANSIT',
	delivered: 'MISSION_CLOSED'
};

const plannedBudget = routeForecast(plannedRouteBudget);
const directBudget = routeForecast(directRouteBudget);

const instructions: Partial<Record<Stage, [string, string]>> = {
	preflight: ['Prepare the rover', 'The planned route to Bravo follows the curve on your map. The module is aboard. Switch on the headlights to begin.'],
	outbound: ['Drive to Bravo', 'Follow the planned curve to Bravo. All systems are nominal.'],
	fault: ['Battery B fault · drive disabled', 'Converter B failed and was isolated automatically. Life support is operational. Check battery A endurance.'],
	assessment: ['Normal endurance · 6 h 20 min', 'Waiting until morning at normal load would require 13.38 kilowatt-hours. Shelter mode reduces power draw. Verify battery isolation before the exterior repair.'],
	'eva-prep': ['Exterior service required', 'Battery B is isolated. The diagnostic found a battery A module loose in its service tray. Check your suit and secure the rover before exiting.'],
	verified: ['Suit checked · rover secured', 'Suit pressure is stable and drive is locked. Cycle the airlock to exit.'],
	'service-walk': ['Walk to the illuminated service panel', 'Follow the marker alongside the rover to the amber service light.'],
	'panel-closed': ['Battery A service panel', 'Open the service hatch. Battery B remains isolated.'],
	'panel-open': ['Battery A module accessible', 'Slide the marked battery A module back into its socket.'],
	'link-seated': ['Battery A module seated', 'Latch the service panel before returning to the airlock.'],
	'return-airlock': ['Return to the airlock', 'Walk back to the airlock marker and board the rover.'],
	airlock: ['Airlock reached', 'Board and confirm cabin pressure before testing the battery bus.'],
	'bus-check': ['Cabin pressurized · bus test pending', 'Run the battery A bus test from the console. Battery B remains isolated.'],
	'bus-verified': ['Battery A bus verified', 'Battery A passed the bus test. Compare routes before authorizing degraded drive.'],
	options: ['Reroute recommended · direct to Bravo', `The planned curve would leave ${decimal(plannedBudget.arrival)} kilowatt-hours, below the ${decimal(reserve)} kilowatt-hour emergency reserve. Take the direct route instead. It leaves ${decimal(directBudget.arrival)} kilowatt-hours.`],
	configured: ['Degraded drive authorized', 'Battery B remains isolated. Load the direct route and start driving when ready.'],
	drive: ['Direct route loaded', 'Drive straight to Bravo on battery A and watch the projected reserve.'],
	park: ['Bravo unloading area', 'You have reached the parking area. Secure the rover.'],
	cargo: ['Spare module aboard', 'Retrieve the module from the cargo compartment.'],
	egress: ['Module secured · airlock ready', 'Exit through the airlock and carry the module to the station entrance.'],
	walk: ['Carry the module to Bravo', 'Walk to the illuminated entrance.'],
	handoff: ['Bravo entrance · delivery pending', 'You are at the station entrance. Hand over the spare module to Bravo.']
};

export type NightfallView = ReturnType<typeof nightfallView>;

export function nightfallView(run: Run, paused: boolean, runId = 0, fast = false, heading = 0) {
	const script = phaseFor(run.stage);
	const [title, text] = run.stage === 'preflight' && run.lights ? ['Headlights on', 'Headlights operational. Start driving when ready.']
		: (run && instructions[run.stage]) ?? [script.title, script.text];
	const budget = driveBudget(run);
	const servicing = onServiceEva(run) && run.serviceStop;
	const service = servicing && servicePoints(servicing);
	const onFoot = !!service || ['walk', 'handoff', 'delivered'].includes(run.stage);
	const departure = ['preflight', 'outbound'].includes(run.stage);
	const faulted = !departure;
	const comparing = run.stage === 'options' || run.stage === 'configured' || run.degraded;
	const target = goal(run);
	const metres = run && target ? Math.round(distanceBetween(run.position, target)) : undefined;
	const bearing = run && target ? (Math.round(Math.atan2(target.x - run.position.x, run.position.z - target.z) * 180 / Math.PI) + 360) % 360 : undefined;
	const destination = run.stage === 'service-walk' ? 'Service panel' : run.stage === 'return-airlock' ? 'Airlock' : run.stage === 'walk' ? 'Bravo entrance' : 'Bravo';
	const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
	const turn = bearing === undefined ? 0 : (bearing - heading + 360) % 360;
	const arrow = arrows[Math.round(turn / 45) % 8];
	const course = `Heading ${Math.round(heading) % 360}° → ${bearing}°`;
	const nav = run.stage === 'outbound' ? `${arrow} Follow the curve · ${course}`
		: target && metres !== undefined ? `${arrow} ${destination} · ${metres} m · ${course}` : undefined;
	const localTime = script.time;
	const message: VisorMessage = {
		title,
		detail: nav ?? (run?.stage === 'assessment' ? 'Shelter ≈ 8.0 kWh until 06:00'
			: run?.stage === 'options' ? `Planned curve ${decimal(plannedBudget.total)} kWh · direct ${decimal(directBudget.total)} kWh · reserve ${decimal(reserve)} kWh`
			: script.id === 'MISSION_CLOSED' ? 'Delivery confirmed · B remains isolated' : undefined),
		kind: script.id === 'POWER_FAULT' ? 'danger' : undefined,
		readouts: [
			{ value: faulted ? decimal(budget.available) : 'A OK', unit: faulted ? 'kWh A' : '' },
			{ value: comparing && script.id !== 'MISSION_CLOSED' ? decimal(budget.arrival) : '−72', unit: comparing && script.id !== 'MISSION_CLOSED' ? 'kWh ETA' : '°C' }
		]
	};
	const terrain: MissionView = {
		point: startPoint, ahead: plannedRoute[1],
		mapObjectiveLabel: service ? 'PANEL' : 'BRAVO',
		baseRoute: false, showPosition: true, tilt: 0,
		samplesCollected: false, drilling: false, drillPaused: false,
		groundRoute: run.stage === 'outbound' ? plannedRoute : run.stage === 'drive' ? run.directRoute : undefined,
		parkedRover: servicing || (onFoot ? run.parkedAt : undefined),
		roverService: service ? {
			open: run.stage === 'panel-open' || run.stage === 'link-seated',
			seated: ['link-seated', 'return-airlock', 'airlock'].includes(run.stage)
		} : undefined,
		inspectionPoint: service && run.stage === 'panel-closed'
			? { x: service.panel.x - 1.7, z: service.panel.z } : undefined,
		cabinTransition: service && run.stage === 'service-walk' ? service.airlock : run.stage === 'bus-check' ? run.serviceStop : undefined,
		headlamps: run.lights && !onFoot ? (faulted && !moving(run) ? 0.62 : 1) : 0,
		inCabin: !onFoot,
		route: service ? [service.airlock, service.panel] : onFoot ? deliveryRoute : run.degraded && run.directRoute ? run.directRoute : plannedRoute,
		map: service && servicing ? { center: servicing, scale: 0.18, objective: service.panel, vehicle: servicing }
			: onFoot ? { center: bravo, scale: 1.6, objective: handoff, vehicle: bravo }
			: { ...driveMap, vehicle: run.position },
		player: {
			run: runId, enabled: moving(run) && !paused, driving: !onFoot, target: departure ? undefined : target,
			forwardSpeed: (departure ? roverSpeedLimitKmh : 8) / 3.6,
			maxSpeed: roverSpeedLimitKmh / 3.6,
			speedMultiplier: onFoot && fast ? 4 : 1
		}
	};
	return {
		time: run.seconds, localTime, paused, message, terrain, title, text,
		key: `${run.stage}:${run.lights}`,
		speaker: 'jarvis' as const,
		state: script.id,
		context: JSON.stringify({
			scenario: 'ARES-02', state: run?.stage ?? script.id, objective: title, guidance: text,
			actions: run && actions(run).map(action => labels[action]), batteryBIsolated: faulted,
			batteryA_kWh: faulted ? budget.available : null, minimumReserve_kWh: reserve,
			predictedArrival_kWh: comparing ? budget.arrival : null,
			activeRoute: run.degraded ? directRouteBudget.name : plannedRouteBudget.name,
			routes: comparing ? [{ ...plannedRouteBudget, ...plannedBudget }, { ...directRouteBudget, ...directBudget }] : undefined,
			waypoint: target && !departure ? { name: destination, distanceMetres: metres, bearingDegrees: bearing } : null,
			cargoSecured: run?.cargoSecured
		})
	};
}

function phaseFor(stage: Stage) {
	return phases.find(phase => phase.id === phasesByStage[stage])!;
}

function decimal(value: number) {
	return value.toFixed(2);
}
