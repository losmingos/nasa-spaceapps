import { distanceBetween, type Point } from '../ares01/route.js';
import { forecast, routes, routeForecast, usableEnergy } from './ares02.js';
import { alternative, alternativeLength, approachLength, directLength, approachNavigation, bravo, fault, handoff, startPoint } from './route.js';

export type Stage = 'preflight' | 'outbound' | 'fault' | 'assessment' | 'diagnostic' | 'verified' | 'options'
	| 'eva-prep' | 'service-walk' | 'panel-closed' | 'panel-open' | 'link-seated' | 'return-airlock' | 'airlock' | 'bus-check' | 'bus-verified'
	| 'configured' | 'drive' | 'park' | 'cargo' | 'egress' | 'walk' | 'handoff' | 'delivered';
export type Action = 'lights' | 'depart' | 'assess' | 'diagnose' | 'compare' | 'configure' | 'drive'
	| 'suit-check' | 'service-exit' | 'open-panel' | 'reseat-link' | 'close-panel' | 'reboard' | 'test-bus'
	| 'park' | 'collect' | 'exit' | 'deliver';

const routeLength = alternativeLength;
const firstLeg = distanceBetween(alternative[0], alternative[1]);
const markers = [alternative[1], bravo];
const plannedKwhPerMetre = routeForecast(routes[1]).total / routeLength;
const actionDelaySeconds = 1;
const checkRadius = 4;
const arrivalRadius = 4;

export interface Run {
	stage: Stage;
	position: Point;
	seconds: number;
	stageAt: number;
	leg: number;
	driven: number;
	degraded: boolean;
	lights: boolean;
	cargoSecured: boolean;
	parkedAt?: Point;
	serviceStop?: Point;
}

export function startRun(): Run {
	return { stage: 'preflight', position: startPoint, seconds: 0, stageAt: -actionDelaySeconds, leg: 0, driven: 0, degraded: false, lights: false, cargoSecured: false };
}

function enter(run: Run, stage: Stage): Run {
	return { ...run, stage, stageAt: run.seconds };
}

export function servicePoints(stop: Point) {
	return {
		airlock: { x: stop.x + 3.5, z: stop.z - 1.6 },
		panel: { x: stop.x + 3.5, z: stop.z + 1.35 }
	};
}

export function onServiceEva(run: Run) {
	return ['service-walk', 'panel-closed', 'panel-open', 'link-seated', 'return-airlock', 'airlock'].includes(run.stage);
}

export function moving(run: Run) {
	return run.stage === 'outbound' || run.stage === 'drive' || run.stage === 'walk' || run.stage === 'service-walk' || run.stage === 'return-airlock';
}

export function goal(run: Run): Point | undefined {
	if (run.stage === 'outbound') return approachNavigation(run.position).ahead;
	if (run.stage === 'drive') return markers[run.leg];
	if (run.stage === 'walk') return handoff;
	if (run.serviceStop && run.stage === 'service-walk') return servicePoints(run.serviceStop).panel;
	if (run.serviceStop && run.stage === 'return-airlock') return servicePoints(run.serviceStop).airlock;
	return undefined;
}

export function routeRemaining(run: Run) {
	if (run.stage === 'preflight' || run.stage === 'outbound') return approachLength - approachNavigation(run.position).progress + directLength;
	if (['park', 'cargo', 'egress', 'walk', 'handoff', 'delivered'].includes(run.stage)) return 0;
	if (!run.degraded) return directLength;
	const target = markers[run.leg];
	return distanceBetween(run.position, target) + (run.leg === 0 ? routeLength - firstLeg : 0);
}

export function driveBudget(run: Run) {
	const available = usableEnergy - run.driven * plannedKwhPerMetre;
	const remaining = routeRemaining(run);
	return { available, remainingKm: remaining / 1000, ...forecast(available, remaining * plannedKwhPerMetre) };
}

export function stepRun(run: Run, delta: number, position: Point): Run {
	const next = { ...run, position, seconds: run.seconds + delta };
	switch (run.stage) {
		case 'outbound': {
			const { progress, offset } = approachNavigation(position);
			return progress >= approachLength - 1 && offset < 5 ? enter(next, 'fault') : next;
		}
		case 'diagnostic':
			if (next.seconds < next.stageAt + 8) return next;
			return enter(next, 'eva-prep');
		case 'drive': {
			next.driven += distanceBetween(run.position, position);
			if (distanceBetween(position, markers[run.leg]) > (run.leg === 2 ? arrivalRadius : checkRadius)) return next;
			if (run.leg === 0) {
				next.leg++;
				return next;
			}
			return enter(next, 'park');
		}
		case 'service-walk':
		case 'return-airlock': {
			const target = goal(run);
			if (!target || distanceBetween(position, target) > (run.stage === 'service-walk' ? 0.65 : 1.2)) return next;
			return enter(next, run.stage === 'service-walk' ? 'panel-closed' : 'airlock');
		}
		case 'walk': return distanceBetween(position, handoff) <= 3 ? enter(next, 'handoff') : next;
		default: return next;
	}
}

export function actions(run: Run): readonly Action[] {
	if (run.seconds < run.stageAt + actionDelaySeconds) return [];
	switch (run.stage) {
		case 'preflight': return run.lights ? ['depart'] : ['lights'];
		case 'fault': return ['assess'];
		case 'assessment': return ['diagnose'];
		case 'eva-prep': return ['suit-check'];
		case 'verified': return ['service-exit'];
		case 'panel-closed': return ['open-panel'];
		case 'panel-open': return ['reseat-link'];
		case 'link-seated': return ['close-panel'];
		case 'airlock': return ['reboard'];
		case 'bus-check': return ['test-bus'];
		case 'bus-verified': return ['compare'];
		case 'configured': return ['drive'];
		case 'options': return routeForecast(routes[1]).viable ? ['configure'] : [];
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
		case 'lights': return enter({ ...run, lights: true }, 'preflight');
		case 'depart': return enter(run, 'outbound');
		case 'assess': return enter(run, 'assessment');
		case 'diagnose': return enter(run, 'diagnostic');
		case 'suit-check': return enter(run, 'verified');
		case 'service-exit': {
			const serviceStop = run.position;
			return enter({ ...run, serviceStop, position: servicePoints(serviceStop).airlock }, 'service-walk');
		}
		case 'open-panel': return enter(run, 'panel-open');
		case 'reseat-link': return enter(run, 'link-seated');
		case 'close-panel': return enter(run, 'return-airlock');
		case 'reboard':
			return run.serviceStop ? enter({ ...run, position: run.serviceStop }, 'bus-check') : run;
		case 'test-bus': return enter(run, 'bus-verified');
		case 'compare': return enter(run, 'options');
		case 'configure': return enter(run, 'configured');
		case 'drive': return enter({ ...run, degraded: true }, 'drive');
		case 'park': return enter({ ...run, parkedAt: run.position }, 'cargo');
		case 'collect': return enter({ ...run, cargoSecured: true }, 'egress');
		case 'exit': return enter(run, 'walk');
		case 'deliver': return enter(run, 'delivered');
	}
}

