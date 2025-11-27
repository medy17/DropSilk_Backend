// --- tests/http.test.js ---
const request = require("supertest");

// Mock telemetry FIRST
const mockEmit = jest.fn();
jest.mock("../src/telemetry", () => ({
    eventBus: { emit: mockEmit },
    EVENTS: jest.requireActual("../src/telemetry/events"),
}));
const { EVENTS } = require("../src/telemetry");

jest.mock("../src/config", () => ({
    PORT: 0,
    NODE_ENV: "test",
    ALLOWED_ORIGINS: new Set(["http://localhost"]),
    VERCEL_PREVIEW_ORIGIN_REGEX: /^https:\/\/.*\.vercel\.app$/,
    LOG_ACCESS_KEY: "test-secret",
    CLOUDFLARE_TURN_TOKEN_ID: "fake-id",
    CLOUDFLARE_API_TOKEN: "fake-token",
    NO_DB: true,
}));

jest.mock("../src/uploadthingHandler", () => ({
    handleUploadThingRequest: (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
    },
}));

jest.mock("../src/dbClient", () => ({
    isDatabaseInitialized: () => false,
    query: jest.fn(),
}));

const { server } = require("../src/httpServer");

describe("HTTP Server Endpoints", () => {
    beforeEach(() => {
        mockEmit.mockClear();
    });

    afterAll((done) => {
        if (server.listening) {
            server.close(done);
        } else {
            done();
        }
    });

    test("GET /logs should be forbidden and emit event on bad key", async () => {
        const res = await request(server).get("/logs?key=wrong-key");
        expect(res.statusCode).toEqual(403);
        expect(mockEmit).toHaveBeenCalledWith(EVENTS.SYSTEM.LOG_ACCESS, {
            status: "unauthorized",
            ip: "127.0.0.1",
        });
    });

    test("GET /logs should work and emit event with correct key", async () => {
        const res = await request(server).get("/logs?key=test-secret");
        expect(res.statusCode).toEqual(200);
        expect(mockEmit).toHaveBeenCalledWith(EVENTS.SYSTEM.LOG_ACCESS, {
            status: "success",
            ip: "127.0.0.1",
        });
    });

    test("GET /api/turn-credentials should emit TURN.ERROR on upstream API failure", async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: false,
                status: 500,
                text: () => Promise.resolve("Cloudflare Down"),
            }),
        );

        const res = await request(server).get("/api/turn-credentials");
        expect(res.statusCode).toEqual(500);
        expect(res.body).toHaveProperty("error");

        expect(mockEmit).toHaveBeenCalledWith(EVENTS.TURN.ERROR, {
            context: "Cloudflare API Error",
            status: 500,
            body: "Cloudflare Down",
        });
    });

    test("GET /api/turn-credentials should emit TURN.CREDENTIALS_ISSUED on success", async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({ iceServers: [{ urls: "stun:test" }] }),
            }),
        );

        const res = await request(server).get("/api/turn-credentials");
        expect(res.statusCode).toEqual(200);

        expect(mockEmit).toHaveBeenCalledWith(EVENTS.TURN.CREDENTIALS_ISSUED, {
            clientIp: "127.0.0.1",
        });
    });
});