// --- tests/socket.test.js ---
const WebSocket = require("ws");
const http = require("http");

// 1. Mock Config & Dependencies
const mockEmit = jest.fn();
jest.mock("../src/telemetry", () => ({
    eventBus: { emit: mockEmit },
    EVENTS: jest.requireActual("../src/telemetry/events"),
}));
const { EVENTS } = require("../src/telemetry");

jest.mock("../src/config", () => ({
    PORT: 0,
    MAX_PAYLOAD: 1024,
    HEALTH_CHECK_INTERVAL: 1000,
    NODE_ENV: "test",
    ALLOWED_ORIGINS: new Set(),
    VERCEL_PREVIEW_ORIGIN_REGEX: /.*/,
}));

jest.mock("../src/uploadthingHandler", () => ({
    handleUploadThingRequest: jest.fn(),
}));

jest.mock("../src/dbClient", () => ({
    isDatabaseInitialized: () => false,
    query: jest.fn(),
}));

// 2. Import dependencies
const {
    initializeSignaling,
    closeConnections,
} = require("../src/signalingService");
const state = require("../src/state");

let server;
let wsServer;
let port;
const clients = [];
const TEST_HOST = "127.0.0.1";

// --- Robust Client Helper with Message Buffering ---
const createClient = () => {
    // (This helper function is unchanged and perfect, no need to modify it)
    const ws = new WebSocket(`ws://${TEST_HOST}:${port}`);
    ws.messageBuffer = [];
    ws.on("message", (data) => {
        try {
            const parsed = JSON.parse(data);
            ws.messageBuffer.push(parsed);
            ws.emit("buffered_message", parsed);
        } catch (e) {
            console.error("Test JSON parse error:", e);
        }
    });
    clients.push(ws);
    return new Promise((resolve, reject) => {
        ws.on("open", () => resolve(ws));
        ws.on("error", reject);
    });
};

// --- Robust Message Waiter ---
const waitForMessage = (ws, type) => {
    // (This helper function is also perfect as is)
    return new Promise((resolve, reject) => {
        const bufferedIndex = ws.messageBuffer.findIndex((m) => m.type === type);
        if (bufferedIndex !== -1) {
            const msg = ws.messageBuffer[bufferedIndex];
            ws.messageBuffer.splice(0, bufferedIndex + 1);
            return resolve(msg);
        }
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for message type: "${type}"`));
        }, 3000);
        const listener = (msg) => {
            if (msg.type === type) {
                cleanup();
                resolve(msg);
            }
        };
        const cleanup = () => {
            clearTimeout(timeout);
            ws.off("buffered_message", listener);
        };
        ws.on("buffered_message", listener);
    });
};

describe("Signaling Service (WebSocket)", () => {
    jest.setTimeout(10000);

    beforeAll((done) => {
        server = http.createServer();
        wsServer = initializeSignaling(server);
        server.listen(0, TEST_HOST, () => {
            port = server.address().port;
            done();
        });
    });

    afterEach(() => {
        mockEmit.mockClear(); // Clear the mock emit function after each test
        state.clients.clear();
        for (const key in state.flights) delete state.flights[key];
        clients.forEach((c) => {
            try {
                c.terminate();
            } catch (e) {}
        });
        clients.length = 0;
    });

    afterAll((done) => {
        closeConnections();
        server.close(done);
    });

    test("Client should connect and emit CLIENT.CONNECTED event", async () => {
        const ws = await createClient();
        const msg = await waitForMessage(ws, "registered");
        expect(msg.id).toBeDefined();

        expect(mockEmit).toHaveBeenCalledWith(
            EVENTS.CLIENT.CONNECTED,
            expect.objectContaining({
                clientId: msg.id,
                ip: "127.0.0.1",
            }),
        );
    });

    test("Client should register name and emit CLIENT.REGISTERED_DETAILS", async () => {
        const ws = await createClient();
        const regMsg = await waitForMessage(ws, "registered");

        ws.send(JSON.stringify({ type: "register-details", name: "TestUser" }));
        await new Promise((r) => setTimeout(r, 50)); // allow server to process

        expect(mockEmit).toHaveBeenCalledWith(EVENTS.CLIENT.REGISTERED_DETAILS, {
            clientId: regMsg.id,
            newName: "TestUser",
        });
    });

    test("Full Flight Flow: Should emit correct events", async () => {
        const host = await createClient();
        const joiner = await createClient();

        await waitForMessage(host, "registered");
        host.send(JSON.stringify({ type: "register-details", name: "Host" }));
        await waitForMessage(joiner, "registered");
        joiner.send(JSON.stringify({ type: "register-details", name: "Joiner" }));

        // Create
        host.send(JSON.stringify({ type: "create-flight" }));
        const flightMsg = await waitForMessage(host, "flight-created");
        const flightCode = flightMsg.flightCode;
        expect(mockEmit).toHaveBeenCalledWith(
            EVENTS.FLIGHT.CREATED,
            expect.objectContaining({ flightCode }),
        );

        // Join
        joiner.send(JSON.stringify({ type: "join-flight", flightCode }));
        await waitForMessage(host, "peer-joined");
        expect(mockEmit).toHaveBeenCalledWith(
            EVENTS.FLIGHT.JOINED,
            expect.objectContaining({ flightCode, joinerName: "Joiner" }),
        );

        // Signal
        const signalData = { sdp: "mock-sdp-data" };
        host.send(JSON.stringify({ type: "signal", data: signalData }));
        await waitForMessage(joiner, "signal");
        expect(mockEmit).toHaveBeenCalledWith(
            EVENTS.FLIGHT.SIGNAL,
            expect.objectContaining({ flightCode }),
        );
    });

    test("Disconnecting should emit CLIENT.DISCONNECTED and FLIGHT.ENDED", async () => {
        const host = await createClient();
        await waitForMessage(host, "registered");
        host.send(JSON.stringify({ type: "create-flight" }));
        const msg = await waitForMessage(host, "flight-created");
        const code = msg.flightCode;

        const hostMeta = Array.from(state.clients.values())[0];

        // Disconnect
        host.terminate();
        await new Promise((r) => setTimeout(r, 100));

        expect(mockEmit).toHaveBeenCalledWith(
            EVENTS.CLIENT.DISCONNECTED,
            expect.objectContaining({
                clientId: hostMeta.id,
                flightCode: code,
            }),
        );

        expect(mockEmit).toHaveBeenCalledWith(
            EVENTS.FLIGHT.ENDED,
            expect.objectContaining({
                flightCode: code,
            }),
        );
    });

    test("Should emit FLIGHT.ERROR if joining a full flight", async () => {
        const host = await createClient();
        const user2 = await createClient();
        const user3 = await createClient();
        await waitForMessage(host, "registered");
        host.send(JSON.stringify({ type: "create-flight" }));
        const flightMsg = await waitForMessage(host, "flight-created");
        const code = flightMsg.flightCode;
        await waitForMessage(user2, "registered");
        user2.send(JSON.stringify({ type: "join-flight", flightCode: code }));
        await waitForMessage(user2, "peer-joined");

        await waitForMessage(user3, "registered");
        user3.send(JSON.stringify({ type: "join-flight", flightCode: code }));
        await waitForMessage(user3, "error");

        expect(mockEmit).toHaveBeenCalledWith(EVENTS.FLIGHT.ERROR, {
            clientId: expect.any(String),
            flightCode: code,
            error: "flight_full",
        });
    });

    test("Should emit CLIENT.ERROR on invalid JSON", async () => {
        const ws = await createClient();
        await waitForMessage(ws, "registered");

        ws.send("this is not json");
        await waitForMessage(ws, "error");

        expect(mockEmit).toHaveBeenCalledWith(
            EVENTS.CLIENT.ERROR,
            expect.objectContaining({ context: "JSON parse error" }),
        );
    });
});