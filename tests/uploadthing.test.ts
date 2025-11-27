// --- tests/uploadthing.test.ts ---

import httpMocks from "node-mocks-http";
import type { IncomingMessage, ServerResponse } from "http";

// --- GLOBAL POLYFILLS ---
class MockHeaders {
    private map = new Map<string, string>();
    set(key: string, value: string) {
        this.map.set(key.toLowerCase(), value);
    }
    forEach(cb: (val: string, key: string) => void) {
        this.map.forEach((v, k) => cb(v, k));
    }
}

class MockResponse {
    status: number;
    headers: MockHeaders;
    private body: Buffer;

    constructor(body?: any, init?: { status?: number }) {
        this.status = init?.status ?? 200;
        this.headers = new MockHeaders();
        const str =
            typeof body === "string" ? body : JSON.stringify(body ?? {});
        this.body = Buffer.from(str);
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
        return this.body.buffer.slice(
            this.body.byteOffset,
            this.body.byteOffset + this.body.byteLength,
        );
    }
}

class MockRequest {}

(global as any).Request = MockRequest as any;
(global as any).Response = MockResponse as any;
(global as any).Headers = MockHeaders as any;

// Helper to access global safely
const globalAny = global as any;

describe("UploadThing Handler", () => {
    let mockEmit: jest.Mock;

    beforeEach(() => {
        // 1. Reset modules to force fresh imports
        jest.resetModules();

        // 2. Clear our global capture variable
        globalAny.__ut_onUploadCompleteCapture = null;

        // 3. Setup Event Bus Mock
        mockEmit = jest.fn();
        jest.doMock("@src/telemetry", () => {
            const realEvents = jest.requireActual("@src/telemetry/events").default;
            return {
                __esModule: true,
                EVENTS: realEvents,
                eventBus: { emit: mockEmit },
            };
        });

        // 4. Setup UploadThing Mock
        // We use 'globalAny' here to bypass closure/scope isolation issues
        jest.doMock("uploadthing/server", () => ({
            __esModule: true,
            createUploadthing: () => () => ({
                middleware: () => ({
                    onUploadComplete: (cb: any) => {
                        globalAny.__ut_onUploadCompleteCapture = cb;
                        return {};
                    },
                }),
            }),
            createRouteHandler: () =>
                jest.fn((_req) => {
                    return new (global.Response as any)(
                        JSON.stringify({ success: true }),
                        { status: 200 },
                    );
                }),
        }));

        // 5. Mock Config & DB
        jest.doMock("@src/config", () => ({
            UPLOADTHING_TOKEN: "sk_live_mock_token_12345",
            PORT: 3000,
        }));

        jest.doMock("@src/dbClient", () => ({
            isDatabaseInitialized: jest.fn(() => true),
            query: jest.fn(),
        }));
    });

    test("onUploadComplete should emit UPLOAD.SUCCESS and DB_SAVED", async () => {
        // 6. Require the SUT inside the test so it picks up the fresh mocks
        const { handleUploadThingRequest } = require("@src/uploadthingHandler");
        const { EVENTS } = require("@src/telemetry");

        const req = httpMocks.createRequest({
            method: "GET",
            url: "/api/uploadthing",
            headers: { host: "localhost:3000" },
        });

        // Async iterator polyfill
        (req as any)[Symbol.asyncIterator] = async function* () {
            yield Buffer.from("");
        };
        const res = httpMocks.createResponse();

        // 7. Trigger the handler
        await handleUploadThingRequest(
            req as IncomingMessage,
            res as ServerResponse,
        );

        // 8. Assert against the GLOBAL variable
        const capturedCallback = globalAny.__ut_onUploadCompleteCapture;
        expect(capturedCallback).toBeInstanceOf(Function);

        // 9. Simulate the webhook callback
        const fileData = {
            file: {
                key: "123-abc",
                url: "https://utfs.io/f/123-abc",
                name: "test.pptx",
            },
        };

        if (capturedCallback) {
            await capturedCallback(fileData);
        }

        // 10. Verify events
        expect(mockEmit).toHaveBeenCalledWith(EVENTS.UPLOAD.SUCCESS, {
            key: "123-abc",
            url: "https://utfs.io/f/123-abc",
        });
        expect(mockEmit).toHaveBeenCalledWith(EVENTS.UPLOAD.DB_SAVED, {
            key: "123-abc",
        });
    });
});