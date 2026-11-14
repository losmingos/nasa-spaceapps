import { distanceBetween } from '../ares01/route.js';
import type { MissionView } from '../../visor/terrain.js';
import type { VisorMessage } from '../../visor/optics.js';
import { havenText, phases, reserve, routes, routeForecast, type Phase } from './ares02.js';
import { actions, driveBudget, goal, moving, type Action, type Run, type Stage } from './interactive.js';
import { alternative, approach, bravo, direct, handoff, startPoint } from './route.js';

export const labels: Record<Action, string> = {
	lights: 'Encender faros', depart: 'Iniciar marcha', assess: 'Consultar autonomía',
	contact: 'Responder a Bravo', diagnose: 'Comprobar aislamiento', compare: 'Comparar rutas',
	configure: 'Autorizar modo degradado', drive: 'Cargar ruta e iniciar marcha',
	verify: 'Comprobar reserva', continue: 'Reanudar marcha', park: 'Estacionar en Bravo',
	collect: 'Recoger el módulo', exit: 'Salir por la esclusa', deliver: 'Entregar el módulo'
};

const outboundRoute = [...approach, { x: 809, z: -3578 }];
const deliveryRoute = [bravo, handoff];

const phasesByStage: Record<Stage, Phase['id']> = {
	preflight: 'NIGHT_TRANSIT', outbound: 'NIGHT_TRANSIT', fault: 'POWER_FAULT', assessment: 'ENERGY_ASSESSMENT',
	comms: 'BRAVO_CONTACT', diagnostic: 'ISOLATION_TEST', verified: 'DEGRADED_DRIVE_READY', options: 'ROUTE_OPTIMIZATION',
	configured: 'DEGRADED_DRIVE_READY', drive: 'DEGRADED_TRANSIT', recheck: 'ENERGY_RECHECK',
	'verified-energy': 'ENERGY_RECHECK', park: 'DEGRADED_TRANSIT', cargo: 'DEGRADED_TRANSIT',
	egress: 'DEGRADED_TRANSIT', walk: 'DEGRADED_TRANSIT', handoff: 'DEGRADED_TRANSIT',
	delivered: 'MISSION_CLOSED', haven: 'POWER_FAULT'
};

const instructions: Partial<Record<Stage, [string, string]>> = {
	preflight: ['Preparar el rover', 'El módulo está a bordo. Enciende los faros para iniciar el tránsito nocturno autorizado.'],
	outbound: ['Conduce hacia Bravo', 'Sigue la línea del corredor hacia Bravo. Los sistemas están nominales.'],
	fault: ['Fallo B · tracción bloqueada', 'El convertidor B ha fallado y la protección lo ha aislado. El soporte vital sigue operativo. Consulta la autonomía de A.'],
	assessment: ['Autonomía normal · 6 h 20 min', 'La espera normal requeriría 13,38 kilovatios hora. El modo refugio reduce el consumo. Informa a Bravo del retraso.'],
	comms: ['Bravo confirma recepción', 'Recibido, ARES-02. Confirmad el plan cuando tengáis margen seguro.'],
	verified: ['Aislamiento y límites verificados', 'A puede alimentar la tracción limitada. Compara las rutas antes de autorizar el modo degradado.'],
	options: ['Directa 9,6 kWh · alternativa 6,7 kWh', 'La ruta alternativa deja 2,8 kilovatios hora al llegar. La reserva mínima es de 2. Puedes autorizar el modo degradado.'],
	configured: ['Modo degradado autorizado', 'El módulo B sigue aislado. Carga la ruta alternativa e inicia la marcha cuando estés listo.'],
	drive: ['Sigue el corredor de menor consumo', 'Tracción limitada con la batería A. Sigue los puntos de paso y vigila la reserva.'],
	recheck: ['Rover detenido · comprueba la reserva', 'El consumo ha aumentado. Comprueba el presupuesto actualizado antes de volver a conducir.'],
	'verified-energy': ['Reserva verificada', 'La proyección sigue por encima del mínimo. Reanuda la marcha hacia Bravo.'],
	park: ['Zona de descarga de Bravo', 'Has llegado al área de estacionamiento. Inmoviliza el rover.'],
	cargo: ['Módulo de reserva a bordo', 'Recoge el módulo del compartimento de carga.'],
	egress: ['Módulo preparado · esclusa lista', 'Sal por la esclusa para llevar el módulo a la entrada de Bravo.'],
	walk: ['Lleva el módulo a Bravo', 'Acércate a pie a la entrada iluminada de Bravo.'],
	handoff: ['Entrada de Bravo · entrega pendiente', 'Ya estás en la entrada. Entrega el módulo de reserva a Bravo.']
};

export type NightfallView = ReturnType<typeof nightfallView>;

export function nightfallView(run: Run, paused: boolean, runId = 0, fast = false, heading = 0) {
	const script = phaseFor(run.stage);
	const [title, text] = run?.haven ? ['Parada de seguridad', havenText[run.haven]]
		: run?.stage === 'preflight' && run.lights ? ['Faros encendidos', 'Faros operativos. Inicia la marcha cuando estés listo.']
		: (run && instructions[run.stage]) ?? [script.title, script.text];
	const budget = driveBudget(run);
	const onFoot = ['walk', 'handoff', 'delivered'].includes(run.stage);
	const departure = ['preflight', 'outbound'].includes(run.stage);
	const faulted = !departure;
	const comparing = run.stage === 'options' || run.stage === 'configured' || run.degraded;
	const target = goal(run);
	const metres = run && target ? Math.round(distanceBetween(run.position, target)) : undefined;
	const bearing = run && target ? (Math.round(Math.atan2(target.x - run.position.x, run.position.z - target.z) * 180 / Math.PI) + 360) % 360 : undefined;
	const destination = run?.stage === 'walk' ? 'Entrada de Bravo' : departure ? 'Corredor' : ['Control', 'Desvío', 'Bravo'][run?.leg ?? 0];
	const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
	const turn = bearing === undefined ? 0 : (bearing - heading + 360) % 360;
	const arrow = arrows[Math.round(turn / 45) % 8];
	const course = `Rumbo ${Math.round(heading) % 360}° → ${bearing}°`;
	const nav = run.stage === 'outbound' ? `${arrow} Sigue la curva · ${course}`
		: target && metres !== undefined ? `${arrow} ${destination} · ${metres} m · ${course}` : undefined;
	const localTime = run?.stage === 'drive' && run.leg > 0 ? 'Ruta en curso' : script.time;
	const message: VisorMessage = {
		title,
		detail: nav ?? (run?.stage === 'assessment' ? 'Refugio ≈ 8,0 kWh hasta las 06:00'
			: run?.stage === 'options' ? 'Disponible 9,5 kWh · llegada 2,8 kWh · mínimo 2,0 kWh'
			: run?.stage === 'recheck' || run?.stage === 'verified-energy' ? `Llegada ${decimal(budget.arrival)} kWh · mínimo 2,0 kWh`
			: script.id === 'MISSION_CLOSED' ? 'Entrega confirmada · B sigue aislada' : undefined),
		kind: run?.haven || script.id === 'POWER_FAULT' ? 'danger' : script.id === 'ENERGY_RECHECK' ? 'warning' : undefined,
		readouts: [
			{ value: faulted ? decimal(budget.available) : 'A OK', unit: faulted ? 'kWh A' : '' },
			{ value: comparing && script.id !== 'MISSION_CLOSED' ? decimal(budget.arrival) : '−72', unit: comparing && script.id !== 'MISSION_CLOSED' ? 'kWh ETA' : '°C' }
		]
	};
	const terrain: MissionView = {
		point: startPoint, ahead: approach[1],
		baseRoute: false, showPosition: true, tilt: 0,
		samplesCollected: false, drilling: false, drillPaused: false,
		groundRoute: run.stage === 'outbound' ? outboundRoute : run.stage === 'drive' ? alternative : undefined,
		parkedRover: onFoot ? run.parkedAt : undefined,
		headlamps: run.lights && !onFoot ? (faulted && !moving(run) ? 0.62 : 1) : 0,
		cameraHeight: onFoot ? undefined : 2.5,
		route: onFoot ? deliveryRoute : comparing ? alternative : departure ? outboundRoute : direct,
		secondaryRoute: comparing && !onFoot ? direct : undefined,
		map: onFoot ? { center: bravo, scale: 1.6, objective: handoff, vehicle: bravo }
			: departure ? { center: { x: 530, z: -3290 }, scale: 8, objective: bravo, vehicle: run.position }
			: { center: { x: 0, z: 0 }, scale: 90, objective: bravo, vehicle: run.position },
		player: {
			run: runId, enabled: moving(run) && !paused, driving: !onFoot, target: departure ? undefined : target,
			forwardSpeed: departure ? 8 : run.leg === 0 ? 5.5 : 4.5,
			speedMultiplier: onFoot ? (fast ? 4 : 1) : (fast ? 16 : 4)
		}
	};
	return {
		time: run.seconds, localTime, paused, message, terrain, title, text,
		key: `${run.stage}:${run.lights}:${run.leg}`,
		speaker: script.id === 'BRAVO_CONTACT' ? 'bravo' as const : 'jarvis' as const,
		state: run?.haven ? 'SAFE_HAVEN' : script.id,
		context: JSON.stringify({
			scenario: 'ARES-02', state: run?.stage ?? script.id, objective: title, guidance: text,
			actions: run && actions(run).map(action => labels[action]), batteryBIsolated: faulted,
			batteryA_kWh: faulted ? budget.available : null, minimumReserve_kWh: reserve,
			predictedArrival_kWh: comparing ? budget.arrival : null,
			routes: comparing ? routes.map(route => ({ ...route, ...routeForecast(route) })) : undefined,
			waypoint: target && !departure ? { name: destination, distanceMetres: metres, bearingDegrees: bearing } : null,
			cargoSecured: run?.cargoSecured
		})
	};
}

function phaseFor(stage: Stage) {
	return phases.find(phase => phase.id === phasesByStage[stage])!;
}

function decimal(value: number) {
	return value.toFixed(1).replace('.', ',');
}
