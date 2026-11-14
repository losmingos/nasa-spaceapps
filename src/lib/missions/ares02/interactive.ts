import { distanceBetween, pointAlong, type Point } from '../ares01/route.js';
import { forecast, routes, routeForecast, usableEnergy, type SafeHavenReason } from './ares02.js';
import { alternative, approachLength, approachNavigation, bravo, fault, handoff, startPoint } from './route.js';

export type Stage = 'preflight' | 'outbound' | 'fault' | 'assessment' | 'comms' | 'diagnostic' | 'verified' | 'options'
	| 'configured' | 'drive' | 'recheck' | 'verified-energy' | 'park' | 'cargo' | 'egress' | 'walk' | 'handoff' | 'delivered' | 'haven';
export type Action = 'lights' | 'depart' | 'assess' | 'contact' | 'diagnose' | 'compare' | 'configure' | 'drive'
	| 'verify' | 'continue' | 'park' | 'collect' | 'exit' | 'deliver';
export type Fault = 'none' | 'isolation' | 'energy';

const routeLength = 8100;
const firstLeg = distanceBetween(alternative[0], alternative[1]);
const checkPoint = pointAlong(alternative, 2100);
const markers = [checkPoint, alternative[1], bravo];
const plannedKwhPerMetre = routeForecast(routes[1]).total / routeLength;
const checkRadius = 24;
const arrivalRadius = 15;

export interface Run {
	stage: Stage;
	position: Point;
	seconds: number;
	stageAt: number;
	leg: number;
	driven: number;
	checkDraw: number;
	degraded: boolean;
	lights: boolean;
	cargoSecured: boolean;
	parkedAt?: Point;
	haven?: SafeHavenReason;
}

export function startRun(): Run {
	return { stage: 'preflight', position: startPoint, seconds: 0, stageAt: 0, leg: 0, driven: 0, checkDraw: 0, degraded: false, lights: false, cargoSecured: false };
}

function enter(run: Run, stage: Stage): Run {
	return { ...run, stage, stageAt: run.seconds };
}

function shelter(run: Run, haven: SafeHavenReason): Run {
	return { ...enter(run, 'haven'), haven };
}

export function moving(run: Run) {
	return run.stage === 'outbound' || run.stage === 'drive' || run.stage === 'walk';
}

export function goal(run: Run): Point | undefined {
	if (run.stage === 'outbound') return approachNavigation(run.position).ahead;
	if (run.stage === 'drive') return markers[run.leg];
	if (run.stage === 'walk') return handoff;
	return undefined;
}

export function routeRemaining(run: Run) {
	if (run.stage === 'preflight' || run.stage === 'outbound') return distanceBetween(run.position, fault) + 7000;
	if (['park', 'cargo', 'egress', 'walk', 'handoff', 'delivered'].includes(run.stage)) return 0;
	if (!run.degraded) return 7000;
	const target = markers[run.leg];
	return distanceBetween(run.position, target) + (run.leg === 0 ? routeLength - 2100 : run.leg === 1 ? routeLength - firstLeg : 0);
}

export function driveBudget(run: Run) {
	const available = usableEnergy - run.driven * plannedKwhPerMetre - run.checkDraw;
	const remaining = routeRemaining(run);
	return { available, remainingKm: remaining / 1000, ...forecast(available, remaining * plannedKwhPerMetre) };
}

export function stepRun(run: Run, delta: number, position: Point, faultMode: Fault): Run {
	const next = { ...run, position, seconds: run.seconds + delta };
	switch (run.stage) {
		case 'outbound': {
			const { progress, offset } = approachNavigation(position);
			return progress >= approachLength - 5 && offset < 35 ? enter(next, 'fault') : next;
		}
		case 'diagnostic':
			if (next.seconds < next.stageAt + 8) return next;
			return faultMode === 'isolation' ? shelter(next, 'isolation') : enter(next, 'verified');
		case 'drive': {
			next.driven += distanceBetween(run.position, position);
			if (!driveBudget(next).viable) return shelter(next, 'energy');
			if (distanceBetween(position, markers[run.leg]) > (run.leg === 2 ? arrivalRadius : checkRadius)) return next;
			if (run.leg === 0) {
				next.checkDraw = faultMode === 'energy' ? 1 : 0.25;
				next.leg++;
				return enter(next, 'recheck');
			}
			if (run.leg === 1) {
				next.leg++;
				return next;
			}
			return enter(next, 'park');
		}
		case 'walk': return distanceBetween(position, handoff) <= 3 ? enter(next, 'handoff') : next;
		default: return next;
	}
}

export function actions(run: Run): readonly Action[] {
	switch (run.stage) {
		case 'preflight': return run.lights ? ['depart'] : ['lights'];
		case 'fault': return ['assess'];
		case 'assessment': return ['contact'];
		case 'comms': return ['diagnose'];
		case 'verified': return ['compare'];
		case 'options': return routeForecast(routes[1]).viable ? ['configure'] : [];
		case 'configured': return ['drive'];
		case 'recheck': return ['verify'];
		case 'verified-energy': return ['continue'];
		case 'park': return ['park'];
		case 'cargo': return ['collect'];
		case 'egress': return ['exit'];
		case 'handoff': return run.cargoSecured ? ['deliver'] : [];
		default: return [];
	}
}

export function act(run: Run, action: Action): Run {
	if (!actions(run).includes(action)) return run;
	switch (action) {
		case 'lights': return { ...run, lights: true };
		case 'depart': return enter(run, 'outbound');
		case 'assess': return enter(run, 'assessment');
		case 'contact': return enter(run, 'comms');
		case 'diagnose': return enter(run, 'diagnostic');
		case 'compare': return enter(run, 'options');
		case 'configure': return enter(run, 'configured');
		case 'drive': return enter({ ...run, degraded: true }, 'drive');
		case 'verify': return driveBudget(run).viable ? enter(run, 'verified-energy') : shelter(run, 'energy');
		case 'continue': return enter(run, 'drive');
		case 'park': return enter({ ...run, parkedAt: run.position }, 'cargo');
		case 'collect': return enter({ ...run, cargoSecured: true }, 'egress');
		case 'exit': return enter(run, 'walk');
		case 'deliver': return enter(run, 'delivered');
	}
}

