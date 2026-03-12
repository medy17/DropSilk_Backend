import fs from "fs";
import path from "path";

export type RoomParticipantRole = "host" | "guest";
export type RoomStatus = "waiting" | "paired" | "ready";

interface StoredRoom {
    roomCode: string;
    hostParticipantId: string;
    hostName: string;
    guestParticipantId: string | null;
    guestName: string | null;
    hostScreenShareActive?: boolean;
    guestScreenShareActive?: boolean;
    hostReady: boolean;
    guestReady: boolean;
    hostFileCount: number;
    guestFileCount: number;
    hostTotalBytes: number;
    guestTotalBytes: number;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
}

export interface RoomParticipantSummary {
    participantId: string;
    role: RoomParticipantRole;
    name: string;
    ready: boolean;
    fileCount: number;
    totalBytes: number;
}

export interface RoomScreenShareSummary {
    activeParticipantId: string | null;
    requestedBySelf: boolean;
    requestedByPeer: boolean;
    isActive: boolean;
}

export interface RoomSummary {
    roomCode: string;
    status: RoomStatus;
    shouldConnect: boolean;
    expiresAt: string;
    self: RoomParticipantSummary;
    peer: RoomParticipantSummary | null;
    screenShare: RoomScreenShareSummary;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "rooms.json");
const ROOM_TTL_MS = 30 * 60 * 1000;

function ensureStoreFile(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_PATH)) {
        fs.writeFileSync(STORE_PATH, "[]", "utf8");
    }
}

function readRooms(): StoredRoom[] {
    ensureStoreFile();
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    try {
        const parsed = JSON.parse(raw) as StoredRoom[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeRooms(rooms: StoredRoom[]): void {
    ensureStoreFile();
    fs.writeFileSync(STORE_PATH, JSON.stringify(rooms, null, 2), "utf8");
}

function getExpiryIso(now: number = Date.now()): string {
    return new Date(now + ROOM_TTL_MS).toISOString();
}

function cleanupExpiredRooms(rooms: StoredRoom[]): StoredRoom[] {
    const now = Date.now();
    return rooms.filter((room) => new Date(room.expiresAt).getTime() > now);
}

function persistRooms(rooms: StoredRoom[]): StoredRoom[] {
    const cleaned = cleanupExpiredRooms(rooms);
    writeRooms(cleaned);
    return cleaned;
}

function randomId(length: number): string {
    return Math.random().toString(36).slice(2, 2 + length);
}

function generateRoomCode(existingCodes: Set<string>): string {
    let code = "";
    do {
        code = Math.random().toString(36).slice(2, 8).toUpperCase();
    } while (existingCodes.has(code) || code.length !== 6);
    return code;
}

function extendRoom(room: StoredRoom): StoredRoom {
    const nowIso = new Date().toISOString();
    room.updatedAt = nowIso;
    room.expiresAt = getExpiryIso();
    return room;
}

function buildParticipantSummary(
    room: StoredRoom,
    role: RoomParticipantRole
): RoomParticipantSummary {
    if (role === "host") {
        return {
            participantId: room.hostParticipantId,
            role: "host",
            name: room.hostName,
            ready: room.hostReady,
            fileCount: room.hostFileCount,
            totalBytes: room.hostTotalBytes,
        };
    }
    return {
        participantId: room.guestParticipantId || "",
        role: "guest",
        name: room.guestName || "Guest",
        ready: room.guestReady,
        fileCount: room.guestFileCount,
        totalBytes: room.guestTotalBytes,
    };
}

function resolveParticipantRole(
    room: StoredRoom,
    participantId: string
): RoomParticipantRole | null {
    if (room.hostParticipantId === participantId) return "host";
    if (room.guestParticipantId === participantId) return "guest";
    return null;
}

function buildSummary(room: StoredRoom, participantId: string): RoomSummary | null {
    const role = resolveParticipantRole(room, participantId);
    if (!role) return null;

    const self = buildParticipantSummary(room, role);
    const peer =
        role === "host"
            ? room.guestParticipantId
                ? buildParticipantSummary(room, "guest")
                : null
            : buildParticipantSummary(room, "host");

    const hasPeer = Boolean(room.guestParticipantId);
    const shouldConnect = hasPeer && (room.hostReady || room.guestReady);
    const hostScreenShareActive = Boolean(room.hostScreenShareActive);
    const guestScreenShareActive = Boolean(room.guestScreenShareActive);
    const activeParticipantId = hostScreenShareActive
        ? room.hostParticipantId
        : guestScreenShareActive
            ? room.guestParticipantId
            : null;
    const status: RoomStatus = !hasPeer
        ? "waiting"
        : shouldConnect
            ? "ready"
            : "paired";

    return {
        roomCode: room.roomCode,
        status,
        shouldConnect,
        expiresAt: room.expiresAt,
        self,
        peer,
        screenShare: {
            activeParticipantId,
            requestedBySelf:
                role === "host" ? hostScreenShareActive : guestScreenShareActive,
            requestedByPeer:
                role === "host" ? guestScreenShareActive : hostScreenShareActive,
            isActive: Boolean(activeParticipantId),
        },
    };
}

function normalizeName(name: string): string {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
        throw new Error("Name is required");
    }
    return trimmed.slice(0, 50);
}

function loadActiveRooms(): StoredRoom[] {
    return persistRooms(readRooms());
}

export function createRoom(hostName: string): RoomSummary {
    const rooms = loadActiveRooms();
    const roomCode = generateRoomCode(new Set(rooms.map((room) => room.roomCode)));
    const room: StoredRoom = {
        roomCode,
        hostParticipantId: randomId(12),
        hostName: normalizeName(hostName),
        guestParticipantId: null,
        guestName: null,
        hostScreenShareActive: false,
        guestScreenShareActive: false,
        hostReady: false,
        guestReady: false,
        hostFileCount: 0,
        guestFileCount: 0,
        hostTotalBytes: 0,
        guestTotalBytes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: getExpiryIso(),
    };

    rooms.push(room);
    writeRooms(rooms);

    const summary = buildSummary(room, room.hostParticipantId);
    if (!summary) {
        throw new Error("Failed to create room");
    }
    return summary;
}

export function joinRoom(roomCode: string, guestName: string): RoomSummary {
    const normalizedCode = roomCode.toUpperCase();
    const rooms = loadActiveRooms();
    const room = rooms.find((candidate) => candidate.roomCode === normalizedCode);

    if (!room) {
        throw new Error("Room not found or expired");
    }
    if (room.guestParticipantId) {
        throw new Error("Room already has two participants");
    }

    room.guestParticipantId = randomId(12);
    room.guestName = normalizeName(guestName);
    extendRoom(room);
    writeRooms(rooms);

    const summary = buildSummary(room, room.guestParticipantId);
    if (!summary) {
        throw new Error("Failed to join room");
    }
    return summary;
}

export function getRoomSummary(
    roomCode: string,
    participantId: string
): RoomSummary | null {
    const normalizedCode = roomCode.toUpperCase();
    const rooms = loadActiveRooms();
    const room = rooms.find((candidate) => candidate.roomCode === normalizedCode);

    if (!room) return null;

    extendRoom(room);
    writeRooms(rooms);
    return buildSummary(room, participantId);
}

export function touchParticipant(
    roomCode: string,
    participantId: string
): RoomSummary | null {
    return getRoomSummary(roomCode, participantId);
}

export function markParticipantReady(
    roomCode: string,
    participantId: string,
    payload: { fileCount?: number; totalBytes?: number } = {}
): RoomSummary | null {
    const normalizedCode = roomCode.toUpperCase();
    const rooms = loadActiveRooms();
    const room = rooms.find((candidate) => candidate.roomCode === normalizedCode);

    if (!room) return null;

    if (room.hostParticipantId === participantId) {
        room.hostReady = true;
        room.hostFileCount = Math.max(0, Number(payload.fileCount) || 0);
        room.hostTotalBytes = Math.max(0, Number(payload.totalBytes) || 0);
    } else if (room.guestParticipantId === participantId) {
        room.guestReady = true;
        room.guestFileCount = Math.max(0, Number(payload.fileCount) || 0);
        room.guestTotalBytes = Math.max(0, Number(payload.totalBytes) || 0);
    } else {
        return null;
    }

    extendRoom(room);
    writeRooms(rooms);
    return buildSummary(room, participantId);
}

export function setParticipantScreenShare(
    roomCode: string,
    participantId: string,
    active: boolean
): RoomSummary | null {
    const normalizedCode = roomCode.toUpperCase();
    const rooms = loadActiveRooms();
    const room = rooms.find((candidate) => candidate.roomCode === normalizedCode);

    if (!room) return null;

    const normalizedActive = Boolean(active);

    if (room.hostParticipantId === participantId) {
        if (normalizedActive && room.guestScreenShareActive) {
            throw new Error("Peer is already screen sharing");
        }
        room.hostScreenShareActive = normalizedActive;
    } else if (room.guestParticipantId === participantId) {
        if (normalizedActive && room.hostScreenShareActive) {
            throw new Error("Peer is already screen sharing");
        }
        room.guestScreenShareActive = normalizedActive;
    } else {
        return null;
    }

    extendRoom(room);
    writeRooms(rooms);
    return buildSummary(room, participantId);
}

export function removeParticipantFromRoom(
    roomCode: string,
    participantId: string
): {
    removed: boolean;
    remainingParticipantId: string | null;
} {
    const normalizedCode = roomCode.toUpperCase();
    const rooms = loadActiveRooms();
    const roomIndex = rooms.findIndex(
        (candidate) => candidate.roomCode === normalizedCode
    );

    if (roomIndex === -1) {
        return { removed: false, remainingParticipantId: null };
    }

    const room = rooms[roomIndex];

    if (room.guestParticipantId === participantId) {
        room.guestParticipantId = null;
        room.guestName = null;
        room.hostScreenShareActive = false;
        room.guestScreenShareActive = false;
        room.guestReady = false;
        room.guestFileCount = 0;
        room.guestTotalBytes = 0;
        extendRoom(room);
        writeRooms(rooms);
        return {
            removed: true,
            remainingParticipantId: room.hostParticipantId,
        };
    }

    if (room.hostParticipantId === participantId) {
        if (!room.guestParticipantId) {
            rooms.splice(roomIndex, 1);
            writeRooms(rooms);
            return { removed: true, remainingParticipantId: null };
        }

        room.hostParticipantId = room.guestParticipantId;
        room.hostName = room.guestName || room.hostName;
        room.hostScreenShareActive = false;
        room.hostReady = room.guestReady;
        room.hostFileCount = room.guestFileCount;
        room.hostTotalBytes = room.guestTotalBytes;
        room.guestParticipantId = null;
        room.guestName = null;
        room.guestScreenShareActive = false;
        room.guestReady = false;
        room.guestFileCount = 0;
        room.guestTotalBytes = 0;
        extendRoom(room);
        writeRooms(rooms);
        return {
            removed: true,
            remainingParticipantId: room.hostParticipantId,
        };
    }

    return { removed: false, remainingParticipantId: null };
}

export function resolveRoomParticipant(
    roomCode: string,
    participantId: string
): { roomCode: string; self: RoomParticipantSummary; peer: RoomParticipantSummary | null } | null {
    const summary = getRoomSummary(roomCode, participantId);
    if (!summary) return null;
    return {
        roomCode: summary.roomCode,
        self: summary.self,
        peer: summary.peer,
    };
}
