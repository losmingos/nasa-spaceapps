import { BASE, DETOUR, DIRECT, distanceBetween, LOOSE_ROCK, pointAlong, ROVER, SAMPLE, type Point } from './route.js';
import { bitacora, dustAt, pressureAt, SAMPLE_STATUS, type Cue, type MissionSnapshot } from './ares01.js';

type Phase = 'site' | 'sampling' | 'advisory' | 'continue' | 'abort' | 'secure'
	| 'junction' | 'hazard' | 'detour' | 'impact' | 'check' | 'resume'
	| 'beacon' | 'lost' | 'rover' | 'board' | 'shelter' | 'drive' | 'park' | 'closed';

const messages: Record<Phase, [string, string]> = {
	site: ['Punto de muestreo', 'Acércate al instrumental e inicia la perforación. Quedan unos diez minutos de trabajo.'],
	sampling: ['Perforación en curso', 'Perforación iniciada. El objetivo es un testigo de lutita del delta de Jezero.'],
	advisory: ['Aviso de polvo', 'El polvo se intensifica. Recomiendo detener la perforación y volver al rover. ¿Continuamos?'],
	continue: ['Muestreo bajo aviso', 'Entendido. Mantengo la vigilancia. El margen de retorno está disminuyendo.'],
	abort: ['Aborto de EVA', 'Alerta crítica. El polvo compromete la navegación. Detén el taladro y regresa al rover.'],
	secure: ['Asegura el instrumental', 'Taladro detenido. Asegura el equipo y guarda el avance y la posición.'],
	junction: ['Retorno a pie', 'Bitácora guardada. Rover a unos trescientos cincuenta metros. Camina hacia el primer punto del corredor.'],
	hazard: ['Ladera inestable', 'Alto. Hay una ladera con regolito suelto. Recomiendo seguir el desvío reconocido, sesenta y cinco metros más largo.'],
	detour: ['Desvío activo', 'Desvío cargado. Sigue el punto de paso hacia el este y mantén la precaución.'],
	impact: ['Impacto contra roca', 'Has pisado una roca suelta. Detecto un impacto en el traje. Detente e inicia la comprobación.'],
	check: ['Verificando el traje', 'Posible daño en la capa exterior. Estoy comprobando la tendencia de presión.'],
	resume: ['Presión estable', 'Presión estable. No detecto fuga. Puede haber daño superficial. Reanuda el regreso con precaución.'],
	beacon: ['Regreso al corredor', 'Continúa por el desvío y sigue el corredor hacia el rover.'],
	lost: ['Posición sin confirmar', 'Alto. He perdido las referencias en el polvo. Solicita posición por la baliza del rover.'],
	rover: ['Posición confirmada', 'Posición confirmada con la baliza y navegación inercial. Continúa hacia la esclusa.'],
	board: ['Esclusa del rover', 'Estás junto a la esclusa. Entra en el rover y confirma la presurización.'],
	shelter: ['EVA finalizada', 'Presurización confirmada. La base está a dos coma cuatro kilómetros. Inicia la conducción cuando estés listo.'],
	drive: ['Conducción a la base', 'Ruta cargada. Mantén una velocidad reducida y sigue el corredor hasta la base.'],
	park: ['Acceso a la base', 'Has llegado al acceso a la base. Detén el rover y confirma la llegada.'],
	closed: ['Base alcanzada', 'Tripulación a salvo. La extracción se interrumpió. Se conservan la posición, las fotografías y el avance.']
};

export type MissionAction = 'drill' | 'continue' | 'abort' | 'secure' | 'detour' | 'check'
	| 'resume' | 'locate' | 'board' | 'drive' | 'finish';

export interface InteractiveMission {
	phase: Phase;
	at: number;
	elapsed: number;
	position: Point;
	weatherStarted: number | null;
	detour: boolean;
	logged: boolean;
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
	return { phase: 'site', at: 0, elapsed: 0, position: START, weatherStarted: null, detour: false, logged: false };
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
		case 'secure': return enter({ ...run, logged: true }, 'junction');
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
	site: 'instrumental', junction: 'cruce', detour: 'punto del desvío', beacon: 'baliza', rover: 'esclusa', drive: 'base'
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
		navigation: lost ? 'Sin referencias' : ['rover', 'board'].includes(phase) || baseRoute ? 'Confirmada' : 'Inercial',
		jump: '', detour: run.detour, walking: move && !driving,
		pressure: phase === 'check' ? pressureAt(run.elapsed - run.at)
			: ['resume', 'beacon', 'lost', 'rover', 'board'].includes(phase) || baseRoute ? pressureAt(9) : 'Nominal',
		critical: phase === 'abort' || lost,
		sheltered: baseRoute && phase !== 'closed',
		sample: SAMPLE_STATUS,
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
