// Shared limits for the visor controls Sara can use (server tool definitions + the visor that applies them).
// Keep import-free.

import type { MapZoomAction } from './types.js';

/** Minimap zoom range. 1 = default (160 m across); 8 = about 20 m across; 0.25 = about 640 m across. */
export const MAP_MIN_ZOOM = 0.25;
export const MAP_MAX_ZOOM = 8;
/** Each voice "zoom in/out" multiplies or divides by this: much stronger than the ±0.5 buttons. */
export const VOICE_ZOOM_FACTOR = 4;
/** Step of the Map +/− buttons and keys. */
export const BUTTON_ZOOM_STEP = 0.5;

export const clampMapZoom = (zoom: number) => Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, zoom));

/** Zoom after a voice command. */
export function voiceMapZoom(current: number, action: MapZoomAction, level?: number): number {
	switch (action) {
		case 'in':
			return clampMapZoom(current * VOICE_ZOOM_FACTOR);
		case 'out':
			return clampMapZoom(current / VOICE_ZOOM_FACTOR);
		case 'reset':
			return 1;
		case 'set':
			return clampMapZoom(level ?? current);
	}
}
