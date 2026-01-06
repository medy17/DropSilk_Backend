// --- tests/http.test.js ---
const request = require("supertest");

// Mock Gossamer emit
const mockEmit = jest.fn();
jest.mock("../src/gossamer", () => ({
    emit: mockEmit,
}));

jest.mock("../src/config", () => ({
    PORT: 0,
    NODE_ENV: "test",
    ALLOWED_ORIGINS: new Set(["http://localhost"]),
    VERCEL_PREVIEW_ORIGIN_REGEX: /^https:\/\/.*\.vercel\.app$/,
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

    test("GET /api/turn-credentials should emit turn:error on upstream API failure", async () => {
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

        expect(mockEmit).toHaveBeenCalledWith("turn:error", {
            context: "Cloudflare API Error",
            status: 500,
            body: "Cloudflare Down",
        });
    });

    test("GET /api/turn-credentials should emit turn:credentials_issued on success", async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({ iceServers: [{ urls: "stun:test" }] }),
            }),
        );

        const res = await request(server).get("/api/turn-credentials");
        expect(res.statusCode).toEqual(200);

        expect(mockEmit).toHaveBeenCalledWith("turn:credentials_issued", {
            clientIp: "127.0.0.1",
        });
    });

    test("GET / should return health check message", async () => {
        const res = await request(server).get("/");
        expect(res.statusCode).toEqual(200);
        expect(res.text).toContain("Server is alive");
    });

    test("GET /stats should return server stats", async () => {
        const res = await request(server).get("/stats");
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty("activeConnections");
        expect(res.body).toHaveProperty("uptime");
    });

    test("GET /unknown should return 404", async () => {
        const res = await request(server).get("/some-unknown-path");
        expect(res.statusCode).toEqual(404);
    });
});