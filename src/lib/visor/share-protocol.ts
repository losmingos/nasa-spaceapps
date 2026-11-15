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
export const SHARE_SOCKET_PROTOCOL = 'ares-share-v1';
export const MAX_SHARE_FRAME = 256 * 1024;

export type ShareTicket = { code: string; key: string } & (
	{ relay: true; iceServers?: never } | { relay?: false; iceServers: RTCIceServer[] }
);
