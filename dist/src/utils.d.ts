import type { IncomingMessage } from "http";
import type { Server } from "http";
export declare function getClientIp(req: IncomingMessage): string;
export declare function getCleanIPv4(ip: string | undefined): string;
export declare function isPrivateIP(ip: string | undefined): boolean;
export declare function getLocalIpForDisplay(): string;
export declare function setupGracefulShutdown(server: Server, closeWsConnectionsCallback?: () => void): void;
//# sourceMappingURL=utils.d.ts.map