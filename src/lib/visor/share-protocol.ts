export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
export const displayCode = (code: string) => code.replace(/^(.{4})(.{4})$/, '$1-$2');

export type Signal = { type: 'offer' | 'answer'; sdp: string };
export type ShareState = {
	viewer?: string;
	offer?: Signal;
	answer?: Signal;
};
export type ShareTicket = { code: string; key: string; iceServers: RTCIceServer[] };
