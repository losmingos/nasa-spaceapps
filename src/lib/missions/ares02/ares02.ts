export const routes = [
	{ id: 'direct', name: 'Corredor directo', km: 7, traction: 7.4, essential: 2.2, terrain: 'Mayor pendiente y resistencia' },
	{ id: 'alternative', name: 'Corredor de menor consumo', km: 8.1, traction: 4.5, essential: 2.2, terrain: 'Menor resistencia al avance' }
] as const;

export const usableEnergy = 9.5;
export const reserve = 2;
export const waitHours = 8 + 55 / 60;
export const normalLoad = 1.5;
export const shelterLoad = 0.9;
export const shelterEnergy = shelterLoad * waitHours;

export function forecast(available: number, remaining: number) {
	const arrival = Math.round((available - remaining) * 100) / 100;
	return { arrival, margin: arrival - reserve, viable: arrival >= reserve };
}

export function routeForecast(route: (typeof routes)[number]) {
	const total = route.traction + route.essential;
	return { total, ...forecast(usableEnergy, total) };
}

export const phases = [
	{ id: 'NIGHT_TRANSIT', time: '20:40', title: 'Tránsito nocturno', text: 'Ruta autorizada hacia Bravo. Llevamos el módulo de reserva para la perforación de las seis. Sistemas nominales.' },
	{ id: 'POWER_FAULT', time: '21:05', title: 'Tracción bloqueada', text: 'Fallo del convertidor del módulo B. La protección automática lo ha aislado. El bus esencial sigue alimentado por A. Soporte vital operativo.' },
	{ id: 'ENERGY_ASSESSMENT', time: '21:07', title: 'Autonomía en parada', text: 'Con 9,5 kilovatios hora y un consumo normal de 1,5 kilovatios, disponemos de seis horas y veinte minutos. Hasta las seis faltaban ocho horas y cincuenta y cinco minutos al producirse el fallo.' },
	{ id: 'BRAVO_CONTACT', time: '21:12', title: 'Contacto con Bravo', text: 'ARES-02, aquí Bravo. Hemos recibido vuestra alerta. Confirma el plan cuando tengas un margen seguro. Necesitamos el módulo para la perforación.' },
	{ id: 'ISOLATION_TEST', time: '21:14', title: 'Verificación eléctrica', text: 'Comprobando el aislamiento de B y los límites de corriente y temperatura de A. El controlador solo admite una reconfiguración con las protecciones activas.' },
	{ id: 'DEGRADED_DRIVE_READY', time: '21:16', title: 'Movilidad degradada disponible', text: 'Aislamiento, temperatura y corriente verificados. El controlador admite tracción limitada con la batería A. La activación requiere tu confirmación.' },
	{ id: 'ROUTE_OPTIMIZATION', time: '21:18', title: 'Decisión de ruta', text: 'La ruta directa requiere 9,6 kilovatios hora. La alternativa de 8,1 kilómetros prevé un consumo de 6,7 y deja 2,8 al llegar. La reserva mínima es de 2 kilovatios hora.' },
	{ id: 'DEGRADED_TRANSIT', time: '21:20', title: 'Tracción limitada', text: 'Movilidad degradada autorizada. Limitando par y velocidad. Supervisaré la energía, la temperatura y la proyección de llegada.' },
	{ id: 'ENERGY_RECHECK', time: 'Ruta en curso', title: 'Demanda de potencia elevada', text: 'Ha subido la demanda de potencia. Reduzco par y velocidad y actualizo la proyección con la energía consumida.' },
	{ id: 'MISSION_CLOSED', time: 'Llegada nocturna', title: 'Estación Bravo alcanzada', text: 'Bravo confirma la entrega del módulo. Tripulación segura. La batería B permanece aislada para inspección. El material está disponible para la perforación de las seis.' }
] as const;

export type Phase = (typeof phases)[number];
export type SafeHavenReason = 'isolation' | 'energy';

export const havenText: Record<SafeHavenReason, string> = {
	isolation: 'El diagnóstico no confirma los límites de la batería A. Tracción bloqueada. Modo refugio activado. Operación aplazada.',
	energy: 'La proyección cae por debajo de la reserva mínima. Rover detenido en un punto seguro del corredor. Modo refugio activado. Operación aplazada.'
};
