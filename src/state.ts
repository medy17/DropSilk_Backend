// --- src/state.ts ---

import type { WebSocket } from "ws";

export interface ClientMetadata {
    id: string;
    name: string;
    flightCode: string | null;
    remoteIp: string;
    connectedAt: string;
    userAgent: string;
}

export interface Flight {
    members: WebSocket[];
    establishedAt: number | null;
}

const clients = new Map<WebSocket, ClientMetadata>();
const flights: Record<string, Flight> = {}; // An object where keys are strings and values are Flight objects.

const connectionStats = {
    totalConnections: 0,
    totalDisconnections: 0,
    totalFlightsCreated: 0,
    totalFlightsJoined: 0,
    startTime: Date.now(),
};

export default {
    clients,
    flights,
    connectionStats,
};