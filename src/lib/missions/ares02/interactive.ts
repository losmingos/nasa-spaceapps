import { distanceBetween, type Point } from '../ares01/route.js';
import { directRouteBudget, forecast, routeForecast, usableEnergy } from './ares02.js';
import { directLength, faultProgress, plannedLength, plannedNavigation, bravo, handoff, startPoint } from './route.js';

export type Stage = 'preflight' | 'outbound' | 'fault' | 'assessment' | 'diagnostic' | 'verified' | 'options'
	| 'eva-prep' | 'service-walk' | 'panel-closed' | 'panel-open' | 'link-seated' | 'return-airlock' | 'airlock' | 'bus-check' | 'bus-verified'
	| 'configured' | 'drive' | 'park' | 'cargo' | 'egress' | 'walk' | 'handoff' | 'delivered';
export type Action = 'lights' | 'depart' | 'assess' | 'diagnose' | 'compare' | 'configure' | 'drive'
	| 'suit-check' | 'service-exit' | 'open-panel' | 'reseat-link' | 'close-panel' | 'reboard' | 'test-bus'
	| 'park' | 'collect' | 'exit' | 'deliver';

const directEnergy = routeForecast(directRouteBudget).total;
const actionDelaySeconds = 1;
const arrivalRadius = 4;

export interface Run {
	stage: Stage;
	position: Point;
	seconds: number;
	stageAt: number;
	driven: number;
	degraded: boolean;
	lights: boolean;
	cargoSecured: boolean;
	parkedAt?: Point;
	serviceStop?: Point;
	directRoute?: readonly [Point, Point];
}

export function startRun(): Run {
	return { stage: 'preflight', position: startPoint, seconds: 0, stageAt: -actionDelaySeconds, driven: 0, degraded: false, lights: false, cargoSecured: false };
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
	if (run.stage === 'outbound') return plannedNavigation(run.position).ahead;
	if (run.stage === 'drive') return bravo;
	if (run.stage === 'walk') return handoff;
	if (run.serviceStop && run.stage === 'service-walk') return servicePoints(run.serviceStop).panel;
	if (run.serviceStop && run.stage === 'return-airlock') return servicePoints(run.serviceStop).airlock;
	return undefined;
}

export function routeRemaining(run: Run) {
	if (run.stage === 'preflight' || run.stage === 'outbound') return plannedLength - plannedNavigation(run.position).progress;
	if (['park', 'cargo', 'egress', 'walk', 'handoff', 'delivered'].includes(run.stage)) return 0;
	return distanceBetween(run.degraded ? run.position : run.directRoute?.[0] ?? run.position, bravo);
}

export function driveBudget(run: Run) {
	const routeLength = run.directRoute ? distanceBetween(...run.directRoute) : directLength;
	const kWhPerMetre = directEnergy / routeLength;
	const available = usableEnergy - run.driven * kWhPerMetre;
	const remaining = routeRemaining(run);
	return { available, remainingKm: remaining / 1000, ...forecast(available, remaining * kWhPerMetre) };
}

export function stepRun(run: Run, delta: number, position: Point): Run {
	const next = { ...run, position, seconds: run.seconds + delta };
	switch (run.stage) {
		case 'outbound': {
			const { progress, offset } = plannedNavigation(position);
			return progress >= faultProgress && offset < 5
				? enter({ ...next, directRoute: [position, bravo] }, 'fault')
				: next;
		}
		case 'diagnostic':
			if (next.seconds < next.stageAt + 8) return next;
			return enter(next, 'eva-prep');
		case 'drive': {
			next.driven += distanceBetween(run.position, position);
			return distanceBetween(position, bravo) <= arrivalRadius ? enter(next, 'park') : next;
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
		case 'options': return routeForecast(directRouteBudget).viable ? ['configure'] : [];
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

