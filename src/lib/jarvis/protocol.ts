// Storm protocol — the single source of truth (D9, D29). Shared by the server prompt and the client UI.
// DRAFT: validate with the team. Hazards are visibility, power and dust — NOT wind force
// (at ~6–7 hPa Martian wind cannot physically knock a person over).
// Keep this file import-free so scripts/gen_lines.ts can import it directly with Node.

export interface ProtocolStep {
	id: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
	name: string;
	instruction: string;
	/** Default automatic trigger (operator keys 1–6 override). */
	trigger: string;
}

export const PROTOCOL: readonly ProtocolStep[] = [
	{ id: 'P1', name: 'STOP & SECURE', instruction: 'Stop sampling. Seal the sample tube and stow it.', trigger: 'storm_t_s >= 0' },
	{ id: 'P2', name: 'SUIT CHECK', instruction: 'Confirm helmet seal; switch on helmet lights and locator beacon.', trigger: 'storm_t_s >= 15' },
	{ id: 'P3', name: 'POWER SAVE', instruction: 'Switch non-essential suit systems off — dust will cut solar recharge.', trigger: 'storm_t_s >= 30' },
	{ id: 'P4', name: 'RETURN', instruction: 'Follow the marked route back to the habitat. Stay on the route; no shortcuts across the scarps.', trigger: 'storm_t_s >= 45' },
	{ id: 'P5', name: 'HOLD IF BLIND', instruction: 'If visibility drops below 20 m: stop, hold position, ping the beacon and wait for guidance. Never cross the delta scarps blind.', trigger: 'visibility_m < 20' },
	{ id: 'P6', name: 'AIRLOCK', instruction: 'Enter the airlock and dust off the suit before entering the habitat.', trigger: 'distance_to_habitat_m <= 10' }
] as const;

/** Seconds after storm_start at which P1–P4 become active by default. */
export const STEP_TIMES_S = { P1: 0, P2: 15, P3: 30, P4: 45 } as const;
/** Visibility (m) below which P5 applies; distance (m) at which P6 applies. */
export const P5_VISIBILITY_M = 20;
export const P6_DISTANCE_M = 10;
