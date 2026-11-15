import { directLength, faultProgress, plannedLength } from './route.js';

export const roverSpeedLimitKmh = 10;

export const plannedRouteBudget = {
	id: 'planned', name: 'Planned curved route', km: (plannedLength - faultProgress) / 1000,
	traction: 0.40, essential: 0.05
} as const;
export const directRouteBudget = {
	id: 'direct', name: 'Direct route', km: directLength / 1000, traction: 0.18, essential: 0.07
} as const;

export const usableEnergy = 9.5;
export const reserve = 9.15;
export const waitHours = 8 + 55 / 60;
export const normalLoad = 1.5;
export const shelterLoad = 0.9;
export const shelterEnergy = shelterLoad * waitHours;

export function forecast(available: number, remaining: number) {
	const arrival = Math.round((available - remaining) * 100) / 100;
	return { arrival, margin: arrival - reserve, viable: arrival >= reserve };
}

export function routeForecast(route: { traction: number; essential: number }) {
	const total = route.traction + route.essential;
	return { total, ...forecast(usableEnergy, total) };
}

export const phases = [
	{ id: 'NIGHT_TRANSIT', time: '20:40', title: 'Night traverse', text: 'The planned route curves around to Bravo. The spare module is aboard for the six o’clock drilling operation. All systems nominal.' },
	{ id: 'POWER_FAULT', time: '21:05', title: 'Drive disabled', text: 'Converter B failed and was isolated automatically. Battery A is powering the essential bus. Life support is operational.' },
	{ id: 'ENERGY_ASSESSMENT', time: '21:07', title: 'Stationary endurance', text: 'At normal load, battery A can last six hours and twenty minutes. At the time of failure, there were eight hours and fifty-five minutes until six.' },
	{ id: 'ISOLATION_TEST', time: '21:14', title: 'Electrical checks', text: 'Checking converter isolation and battery A current and temperature limits. Drive can only be reconfigured with protections active.' },
	{ id: 'DEGRADED_DRIVE_READY', time: '21:16', title: 'Degraded drive available', text: 'Isolation, temperature and current verified. Battery A can power limited drive. Activation requires your confirmation.' },
	{ id: 'ROUTE_OPTIMIZATION', time: '21:18', title: 'Route decision', text: 'The planned curve would leave too little energy for the emergency reserve. The direct route meets the reserve requirement.' },
	{ id: 'DEGRADED_TRANSIT', time: '21:20', title: 'Limited drive', text: 'Degraded drive authorized. Torque and speed are limited. I will monitor energy, temperature and the projected reserve on arrival.' },

	{ id: 'MISSION_CLOSED', time: 'Night arrival', title: 'Bravo Station reached', text: 'Bravo confirms receipt of the module. The crew is safe. Battery B remains isolated for inspection. The module is ready for drilling at six.' }
] as const;

export type Phase = (typeof phases)[number];
