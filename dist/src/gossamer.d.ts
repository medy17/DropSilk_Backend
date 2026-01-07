/**
 * Initialize Gossamer telemetry.
 * Must be called before any emit() calls.
 */
export declare function initGossamer(): Promise<void>;
/**
 * Emit a telemetry event.
 * @param eventName - Event name (e.g., "flight:created")
 * @param payload - Event payload
 */
export declare function emit(eventName: string, payload?: Record<string, unknown>): void;
/**
 * Emit an error event with standardized error payload.
 * @param eventName - Event name (e.g., "client:error")
 * @param error - The error object
 * @param additionalPayload - Additional context
 */
export declare function emitError(eventName: string, error: unknown, additionalPayload?: Record<string, unknown>): void;
/**
 * Flush all transports. Useful for graceful shutdown.
 */
export declare function flush(): Promise<void>;
//# sourceMappingURL=gossamer.d.ts.map