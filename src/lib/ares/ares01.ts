import { BASE, DETOUR, DIRECT, pointAlong, ROVER, SAMPLE } from './route.js';

export const DURATION = 210;
export const SOURCE = 'SIMULADO · guion ARES-01';
export const SAMPLE_STATUS = 'not_collected';

// Fixture readings for the scripted check, in kPa. The 9 s window is a demo assumption.
const pressureReadings = [30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0];
const pressureCheckStart = 113;
const pressureWindowEnd = pressureCheckStart + pressureReadings.length - 1;
const bitacora = {
	site: 'Terraza ficticia del delta occidental',
	strata: 'Estratos fotografiados durante el reconocimiento',
	progress: 'Perforación interrumpida antes de extraer el testigo',
	position: SAMPLE
};

interface Cue {
	at: number;
	id: string;
	state: string;
	title: string;
	text: string;
}

const cues: readonly Cue[] = [
	{ at: 0, id: 'sample', state: 'SAMPLING', title: 'Extracción del testigo', text: 'Objetivo localizado. Depósito sedimentario compatible con un antiguo ambiente lacustre. Quedan unos diez minutos de extracción.' },
	{ at: 20, id: 'advisory', state: 'WEATHER_ADVISORY', title: 'Aviso de polvo', text: 'El polvo se intensifica más rápido de lo previsto. Recomiendo abortar el muestreo y volver al rover. ¿Deseas continuar?' },
	{ at: 40, id: 'abort', state: 'EVA_ABORT', title: 'EVA ABORT — RETURN REQUIRED', text: 'Alerta crítica. La pérdida de visibilidad y de referencias al terreno compromete el regreso. Aborta el muestreo y regresa al rover.' },
	{ at: 44, id: 'prepare', state: 'RETURN_PREP', title: 'Asegurar el instrumental', text: 'La extracción requiere diez minutos. El margen de retorno es insuficiente. Detén el taladro y registra la posición y el avance.' },
	{ at: 65, id: 'return', state: 'RETURN_EVA', title: 'Retorno a pie', text: 'Rover a 350 metros. Sigue el corredor marcado. Prioridad: retorno seguro.' },
	{ at: 90, id: 'hazard', state: 'HAZARD_DETECTED', title: 'Ladera inestable', text: 'Detente. El corredor previsto cruza una ladera con regolito suelto. La pendiente y el material elevan el riesgo de caída.' },
	{ at: 93, id: 'reroute', state: 'REROUTE', title: 'Desvío recomendado · +65 m', text: 'La cartografía indica un corredor alternativo por terreno previamente reconocido. Añade 65 metros y evita la zona inestable.' },
	{ at: 100, id: 'reroute-accepted', state: 'REROUTE', title: 'Desvío activo', text: 'Ruta actualizada. Sigue el corredor alternativo hacia el punto de paso.' },
	{ at: 108, id: 'trip', state: 'SUIT_DIAGNOSTIC', title: 'Pérdida de equilibrio', text: 'Una roca suelta cede bajo la bota al tomar el desvío.' },
	{ at: 111, id: 'impact', state: 'SUIT_DIAGNOSTIC', title: 'Impacto contra roca', text: 'El traje roza una arista. Detén la marcha.' },
	{ at: 113, id: 'pressure-check', state: 'SUIT_DIAGNOSTIC', title: 'SUIT INTEGRITY CHECK', text: 'Sensor de integridad anómalo. Verificando la tendencia de presión interna.' },
	{ at: 117, id: 'outer-damage', state: 'SUIT_DIAGNOSTIC', title: 'Posible daño exterior', text: 'Posible daño en la capa exterior del traje. Continúo comprobando la presión.' },
	{ at: 122, id: 'pressure-stable', state: 'SUIT_DIAGNOSTIC', title: 'Presión interna estable', text: 'Sin fuga detectada en la ventana de presión. Posible daño superficial. Limita el movimiento de la zona afectada y continúa con precaución.' },
	{ at: 125, id: 'position', state: 'LOCALIZATION_CHECK', title: 'Posición confirmada', text: 'Navegación inercial y referencias del rover coinciden dentro del margen de la demo. Rover a 90 metros.' },
	{ at: 149, id: 'approach', state: 'RETURN_EVA', title: 'Aproximación al rover', text: 'Referencias del vehículo confirmadas. Continúa hacia la esclusa.' },
	{ at: 155, id: 'shelter', state: 'ROVER_SHELTER', title: 'Rover presurizado · EVA finalizada', text: 'Entrada completada. Presurización confirmada.' },
	{ at: 180, id: 'base-return', state: 'BASE_RETURN', title: 'Retorno a la base · 2,4 km', text: 'Ruta de retorno cargada. Conduce a velocidad reducida por el itinerario reconocido.' },
	{ at: 210, id: 'closed', state: 'MISSION_CLOSED', title: 'Base alcanzada · tripulación a salvo', text: 'El deterioro meteorológico interrumpió la extracción. Se conservan las fotografías, la ubicación y el avance para una futura operación.' }
];

const hold: Cue = { at: 0, id: 'position-lost', state: 'LOCALIZATION_CHECK', title: 'Alto · posición sin confirmar', text: 'Detén la marcha. La solución de navegación ha perdido sus referencias. Solicita relocalización con el rover.' };
const earlyReturn: Cue = { at: 20, id: 'early-return', state: 'RETURN_PREP', title: 'Retorno preventivo', text: 'Muestreo interrumpido. Asegura el taladro y registra el avance antes de partir.' };
const continued: Cue = { at: 25, id: 'continue', state: 'CONTINUE_WITH_WARNING', title: 'Muestreo bajo aviso', text: 'Entendido. Mantendré la monitorización. El margen de seguridad está disminuyendo.' };

export function missionAt(time: number, choice?: 'continue' | 'return', positionLost = false) {
	const second = Math.floor(time);
	let cue = cues.findLast(({ at }) => at <= second) ?? cues[0];
	if (choice === 'return' && second >= 20 && second < 65) cue = earlyReturn;
	if (choice === 'continue' && second >= 20 && second < 40) cue = continued;
	if (positionLost) cue = hold;

	const walking = second >= 65 && second < 155;
	const pressureWindow = second < pressureCheckStart ? [] : pressureReadings.slice(0, second - pressureCheckStart + 1);
	const pressure = pressureWindow.length === 0 ? 'Nominal'
		: second < pressureWindowEnd ? 'Comprobando tendencia'
		: pressureWindow.every((reading) => reading === pressureWindow[0])
			? 'Estable · sin fuga detectada' : 'Variación · requiere revisión';
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
		? { x: SAMPLE.x - 3, z: SAMPLE.z - 2 }
		: BASE;
	const dust = Math.min(1, Math.max(0, (time - 17) / 30));
	const navigation = positionLost ? 'Sin referencias' : second < 20 ? 'Nominal' : second < 125 ? 'Degradada' : 'Confirmada';
	const jump = second >= 125 && second < 131 ? '+ varios minutos de marcha'
		: second >= 149 && second < 153 ? '+ tramo final de marcha'
		: second >= 205 && second < 210 ? '+ trayecto de 2,4 km en rover' : '';

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
			distanceToRoverM: snapshot.positionLost || snapshot.sheltered || time >= DURATION ? null : snapshot.remaining
		}
	};
}
