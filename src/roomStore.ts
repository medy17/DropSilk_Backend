import type { QueryResult, QueryResultRow } from "pg";
import { query, withTransaction } from "./dbClient";
import config from "./config";

export type RoomParticipantRole = "host" | "guest";
export type RoomStatus = "waiting" | "paired" | "ready";

interface StoredRoomRow {
    room_code: string;
    host_participant_id: string;
    host_name: string;
    guest_participant_id: string | null;
    guest_name: string | null;
    host_screen_share_active: boolean;
    guest_screen_share_active: boolean;
    host_ready: boolean;
    guest_ready: boolean;
    host_file_count: number;
    guest_file_count: number;
    host_total_bytes: number | string;
    guest_total_bytes: number | string;
    created_at: Date | string;
    updated_at: Date | string;
    expires_at: Date | string;
}

interface Queryable {
    query<T extends QueryResultRow = StoredRoomRow>(
        text: string,
        params?: unknown[]
    ): Promise<QueryResult<T>>;
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

const ROOM_COLUMNS = `
    room_code,
    host_participant_id,
    host_name,
    guest_participant_id,
    guest_name,
    host_screen_share_active,
    guest_screen_share_active,
    host_ready,
    guest_ready,
    host_file_count,
    guest_file_count,
    host_total_bytes,
    guest_total_bytes,
    created_at,
    updated_at,
    expires_at
`;

function getExpiryDate(now: number = Date.now()): Date {
    return new Date(now + config.ROOM_TTL_MS);
}

function randomId(length: number): string {
    return Math.random().toString(36).slice(2, 2 + length);
}

function generateRoomCode(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizeName(name: string): string {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
        throw new Error("Name is required");
    }
    return trimmed.slice(0, 50);
}

function toIso(value: Date | string): string {
    return new Date(value).toISOString();
}

function toNumber(value: number | string | null | undefined): number {
    return Math.max(0, Number(value) || 0);
}

function resolveParticipantRole(
    room: StoredRoomRow,
    participantId: string
): RoomParticipantRole | null {
    if (room.host_participant_id === participantId) return "host";
    if (room.guest_participant_id === participantId) return "guest";
    return null;
}

function buildParticipantSummary(
    room: StoredRoomRow,
    role: RoomParticipantRole
): RoomParticipantSummary {
    if (role === "host") {
        return {
            participantId: room.host_participant_id,
            role: "host",
            name: room.host_name,
            ready: room.host_ready,
            fileCount: room.host_file_count,
            totalBytes: toNumber(room.host_total_bytes),
        };
    }

    return {
        participantId: room.guest_participant_id || "",
        role: "guest",
        name: room.guest_name || "Guest",
        ready: room.guest_ready,
        fileCount: room.guest_file_count,
        totalBytes: toNumber(room.guest_total_bytes),
    };
}

function buildSummary(room: StoredRoomRow, participantId: string): RoomSummary | null {
    const role = resolveParticipantRole(room, participantId);
    if (!role) return null;

    const self = buildParticipantSummary(room, role);
    const peer =
        role === "host"
            ? room.guest_participant_id
                ? buildParticipantSummary(room, "guest")
                : null
            : buildParticipantSummary(room, "host");

    const hasPeer = Boolean(room.guest_participant_id);
    const shouldConnect = hasPeer && (room.host_ready || room.guest_ready);
    const hostScreenShareActive = Boolean(room.host_screen_share_active);
    const guestScreenShareActive = Boolean(room.guest_screen_share_active);
    const activeParticipantId = hostScreenShareActive
        ? room.host_participant_id
        : guestScreenShareActive
            ? room.guest_participant_id
            : null;
    const status: RoomStatus = !hasPeer
        ? "waiting"
        : shouldConnect
            ? "ready"
            : "paired";

    return {
        roomCode: room.room_code,
        status,
        shouldConnect,
        expiresAt: toIso(room.expires_at),
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

async function fetchRoom(
    db: Queryable,
    roomCode: string,
    lockForUpdate: boolean = false
): Promise<StoredRoomRow | null> {
    const lockClause = lockForUpdate ? " FOR UPDATE" : "";
    const result = await db.query<StoredRoomRow>(
        `
            SELECT ${ROOM_COLUMNS}
            FROM rooms
            WHERE room_code = $1 AND expires_at > NOW()
            ${lockClause}
        `,
        [roomCode]
    );
    return result.rows[0] || null;
}

async function extendRoom(
    db: Queryable,
    roomCode: string,
    participantId?: string
): Promise<StoredRoomRow | null> {
    const participantClause = participantId
        ? "AND (host_participant_id = $3 OR guest_participant_id = $3)"
        : "";
    const params = participantId
        ? [roomCode, getExpiryDate(), participantId]
        : [roomCode, getExpiryDate()];
    const result = await db.query<StoredRoomRow>(
        `
            UPDATE rooms
            SET updated_at = NOW(), expires_at = $2
            WHERE room_code = $1
              AND expires_at > NOW()
              ${participantClause}
            RETURNING ${ROOM_COLUMNS}
        `,
        params
    );
    return result.rows[0] || null;
}

export async function createRoom(hostName: string): Promise<RoomSummary> {
    const normalizedHostName = normalizeName(hostName);

    for (let attempt = 0; attempt < 10; attempt++) {
        const roomCode = generateRoomCode();
        const hostParticipantId = randomId(12);
        const now = new Date();
        const expiresAt = getExpiryDate(now.getTime());

        try {
            const result = await query<StoredRoomRow>(
                `
                    INSERT INTO rooms (
                        room_code,
                        host_participant_id,
                        host_name,
                        guest_participant_id,
                        guest_name,
                        host_screen_share_active,
                        guest_screen_share_active,
                        host_ready,
                        guest_ready,
                        host_file_count,
                        guest_file_count,
                        host_total_bytes,
                        guest_total_bytes,
                        created_at,
                        updated_at,
                        expires_at
                    )
                    VALUES (
                        $1, $2, $3, NULL, NULL, FALSE, FALSE, FALSE, FALSE, 0, 0, 0, 0, $4, $4, $5
                    )
                    RETURNING ${ROOM_COLUMNS}
                `,
                [roomCode, hostParticipantId, normalizedHostName, now, expiresAt]
            );

            const summary = buildSummary(result.rows[0], hostParticipantId);
            if (!summary) {
                throw new Error("Failed to create room");
            }
            return summary;
        } catch (error) {
            const err = error as { code?: string };
            if (err.code === "23505") {
                continue;
            }
            throw error;
        }
    }

    throw new Error("Failed to allocate unique room code");
}

export async function joinRoom(roomCode: string, guestName: string): Promise<RoomSummary> {
    const normalizedCode = roomCode.toUpperCase();
    const normalizedGuestName = normalizeName(guestName);

    return withTransaction(async (client) => {
        const room = await fetchRoom(client, normalizedCode, true);

        if (!room) {
            throw new Error("Room not found or expired");
        }
        if (room.guest_participant_id) {
            throw new Error("Room already has two participants");
        }

        const guestParticipantId = randomId(12);
        const result = await client.query<StoredRoomRow>(
            `
                UPDATE rooms
                SET
                    guest_participant_id = $2,
                    guest_name = $3,
                    updated_at = NOW(),
                    expires_at = $4
                WHERE room_code = $1
                RETURNING ${ROOM_COLUMNS}
            `,
            [normalizedCode, guestParticipantId, normalizedGuestName, getExpiryDate()]
        );

        const summary = buildSummary(result.rows[0], guestParticipantId);
        if (!summary) {
            throw new Error("Failed to join room");
        }
        return summary;
    });
}

export async function getRoomSummary(
    roomCode: string,
    participantId: string
): Promise<RoomSummary | null> {
    const normalizedCode = roomCode.toUpperCase();
    const extendedRoom = await extendRoom({ query }, normalizedCode, participantId);
    return extendedRoom ? buildSummary(extendedRoom, participantId) : null;
}

export function touchParticipant(
    roomCode: string,
    participantId: string
): Promise<RoomSummary | null> {
    return getRoomSummary(roomCode, participantId);
}

export async function markParticipantReady(
    roomCode: string,
    participantId: string,
    payload: { fileCount?: number; totalBytes?: number } = {}
): Promise<RoomSummary | null> {
    const normalizedCode = roomCode.toUpperCase();

    return withTransaction(async (client) => {
        const room = await fetchRoom(client, normalizedCode, true);
        if (!room) return null;

        let updateQuery = "";
        if (room.host_participant_id === participantId) {
            updateQuery = `
                UPDATE rooms
                SET
                    host_ready = TRUE,
                    host_file_count = $2,
                    host_total_bytes = $3,
                    updated_at = NOW(),
                    expires_at = $4
                WHERE room_code = $1
                RETURNING ${ROOM_COLUMNS}
            `;
        } else if (room.guest_participant_id === participantId) {
            updateQuery = `
                UPDATE rooms
                SET
                    guest_ready = TRUE,
                    guest_file_count = $2,
                    guest_total_bytes = $3,
                    updated_at = NOW(),
                    expires_at = $4
                WHERE room_code = $1
                RETURNING ${ROOM_COLUMNS}
            `;
        } else {
            return null;
        }

        const result = await client.query<StoredRoomRow>(updateQuery, [
            normalizedCode,
            toNumber(payload.fileCount),
            toNumber(payload.totalBytes),
            getExpiryDate(),
        ]);

        return buildSummary(result.rows[0], participantId);
    });
}

export async function setParticipantScreenShare(
    roomCode: string,
    participantId: string,
    active: boolean
): Promise<RoomSummary | null> {
    const normalizedCode = roomCode.toUpperCase();
    const normalizedActive = Boolean(active);

    return withTransaction(async (client) => {
        const room = await fetchRoom(client, normalizedCode, true);
        if (!room) return null;

        let updateQuery = "";
        if (room.host_participant_id === participantId) {
            if (normalizedActive && room.guest_screen_share_active) {
                throw new Error("Peer is already screen sharing");
            }
            updateQuery = `
                UPDATE rooms
                SET
                    host_screen_share_active = $2,
                    updated_at = NOW(),
                    expires_at = $3
                WHERE room_code = $1
                RETURNING ${ROOM_COLUMNS}
            `;
        } else if (room.guest_participant_id === participantId) {
            if (normalizedActive && room.host_screen_share_active) {
                throw new Error("Peer is already screen sharing");
            }
            updateQuery = `
                UPDATE rooms
                SET
                    guest_screen_share_active = $2,
                    updated_at = NOW(),
                    expires_at = $3
                WHERE room_code = $1
                RETURNING ${ROOM_COLUMNS}
            `;
        } else {
            return null;
        }

        const result = await client.query<StoredRoomRow>(updateQuery, [
            normalizedCode,
            normalizedActive,
            getExpiryDate(),
        ]);

        return buildSummary(result.rows[0], participantId);
    });
}

export async function removeParticipantFromRoom(
    roomCode: string,
    participantId: string
): Promise<{
    removed: boolean;
    remainingParticipantId: string | null;
}> {
    const normalizedCode = roomCode.toUpperCase();

    return withTransaction(async (client) => {
        const room = await fetchRoom(client, normalizedCode, true);
        if (!room) {
            return { removed: false, remainingParticipantId: null };
        }

        if (room.guest_participant_id === participantId) {
            const result = await client.query<StoredRoomRow>(
                `
                    UPDATE rooms
                    SET
                        guest_participant_id = NULL,
                        guest_name = NULL,
                        host_screen_share_active = FALSE,
                        guest_screen_share_active = FALSE,
                        guest_ready = FALSE,
                        guest_file_count = 0,
                        guest_total_bytes = 0,
                        updated_at = NOW(),
                        expires_at = $2
                    WHERE room_code = $1
                    RETURNING ${ROOM_COLUMNS}
                `,
                [normalizedCode, getExpiryDate()]
            );

            return {
                removed: true,
                remainingParticipantId: result.rows[0].host_participant_id,
            };
        }

        if (room.host_participant_id === participantId) {
            if (!room.guest_participant_id) {
                await client.query("DELETE FROM rooms WHERE room_code = $1", [normalizedCode]);
                return { removed: true, remainingParticipantId: null };
            }

            const result = await client.query<StoredRoomRow>(
                `
                    UPDATE rooms
                    SET
                        host_participant_id = guest_participant_id,
                        host_name = COALESCE(guest_name, host_name),
                        host_screen_share_active = FALSE,
                        host_ready = guest_ready,
                        host_file_count = guest_file_count,
                        host_total_bytes = guest_total_bytes,
                        guest_participant_id = NULL,
                        guest_name = NULL,
                        guest_screen_share_active = FALSE,
                        guest_ready = FALSE,
                        guest_file_count = 0,
                        guest_total_bytes = 0,
                        updated_at = NOW(),
                        expires_at = $2
                    WHERE room_code = $1
                    RETURNING ${ROOM_COLUMNS}
                `,
                [normalizedCode, getExpiryDate()]
            );

            return {
                removed: true,
                remainingParticipantId: result.rows[0].host_participant_id,
            };
        }

        return { removed: false, remainingParticipantId: null };
    });
}

export async function resolveRoomParticipant(
    roomCode: string,
    participantId: string
): Promise<{
    roomCode: string;
    self: RoomParticipantSummary;
    peer: RoomParticipantSummary | null;
} | null> {
    const summary = await getRoomSummary(roomCode, participantId);
    if (!summary) return null;
    return {
        roomCode: summary.roomCode,
        self: summary.self,
        peer: summary.peer,
    };
}

export async function deleteExpiredRooms(): Promise<number> {
    const result = await query("DELETE FROM rooms WHERE expires_at <= NOW()");
    return result.rowCount || 0;
}
