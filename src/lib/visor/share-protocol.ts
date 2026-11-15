import type { VisorMessage, VisorReadings, XrHudControls } from './optics.js';
import type { MissionView, TerrainDisplayMode } from './terrain.js';
import type { XrMenuPage } from './xr-controls.js';

export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
export const displayCode = (code: string) => code.replace(/^(.{4})(.{4})$/, '$1-$2');

export const SHARE_SOCKET_PROTOCOL = 'ares-state-v1';
export const MAX_SHARE_STATE = 64 * 1024;
export const POSE_BYTES = 52;

export type ShareTicket = { code: string; key: string };
export type ShareMenu = Omit<XrMenuPage, 'items'> & {
	items: Pick<XrMenuPage['items'][number], 'id' | 'label' | 'active' | 'disabled'>[];
};
export type ShareHud = {
	type: 'hud';
	menu?: ShareMenu;
	controls?: Omit<XrHudControls, 'time'>;
	message: VisorMessage;
	subtitle?: string;
	clock: string;
	readings: VisorReadings;
	notice: string;
};
export type ShareWorld = {
	type: 'world';
	mission?: 'ares01' | 'ares02';
	stage?: string;
	view?: MissionView;
	sol: number;
	dust: number;
	wind: number | null;
	display: TerrainDisplayMode;
	flashlight: boolean;
	mapZoom: number;
};

// Rig position, world-space head position and quaternion, rover yaw, speed, vertical FOV.
export type SharePose = Float32Array<ArrayBuffer>;

export function readShareState(data: string): ShareWorld | ShareHud | undefined {
	if (data.length > MAX_SHARE_STATE) return;
	try {
		const value = JSON.parse(data);
		if (value?.type === 'world' && Number.isFinite(value.sol) && Number.isFinite(value.dust) &&
			Number.isFinite(value.mapZoom) && ['visible', 'danger', 'swir'].includes(value.display) &&
			(!value.mission || value.mission === 'ares01' || value.mission === 'ares02')) return value;
		if (value?.type === 'hud' && typeof value.clock === 'string' && typeof value.message?.title === 'string' &&
			Number.isFinite(value.readings?.o2Percent)) return value;
	} catch {
		// Ignore invalid messages.
	}
}

export function readSharePose(data: ArrayBuffer): SharePose | undefined {
	if (data.byteLength !== POSE_BYTES) return;
	const pose = new Float32Array(data);
	if (pose.every(Number.isFinite) && Math.hypot(pose[6], pose[7], pose[8], pose[9]) > 0.9 && pose[12] > 0 && pose[12] < 180) return pose;
}
