import type WebSocket from "ws";
/** Metadata stored for each connected WebSocket client */
export interface ClientMetadata {
    id: string;
    name: string;
    flightCode: string | null;
    remoteIp: string;
    connectedAt: string;
    userAgent: string;
}
/** Represents an active flight session between clients */
export interface Flight {
    members: WebSocket[];
    establishedAt: number | null;
}
/** Aggregate connection statistics */
export interface ConnectionStats {
    totalConnections: number;
    totalDisconnections: number;
    totalFlightsCreated: number;
    totalFlightsJoined: number;
    startTime: number;
}
/** Map of WebSocket connections to their metadata */
export declare const clients: Map<WebSocket, ClientMetadata>;
/** Record of active flights by flight code */
export declare const flights: Record<string, Flight>;
/** Aggregate connection statistics */
export declare const connectionStats: ConnectionStats;
//# sourceMappingURL=state.d.ts.map