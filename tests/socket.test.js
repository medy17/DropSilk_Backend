// tests/socket.test.js
const WebSocket = require('ws');
const http = require('http');

// 1. Mock Config & Dependencies
jest.mock('../src/config', () => ({
    PORT: 0,
    MAX_PAYLOAD: 1024,
    HEALTH_CHECK_INTERVAL: 1000,
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: new Set(),
    VERCEL_PREVIEW_ORIGIN_REGEX: /.*/
}));

jest.mock('../src/uploadthingHandler', () => ({
    handleUploadThingRequest: jest.fn()
}));

jest.mock('../src/dbClient', () => ({
    isDatabaseInitialized: () => false,
    query: jest.fn()
}));

// 2. Import dependencies
const { initializeSignaling, closeConnections } = require('../src/signalingService');
const state = require('../src/state');

let server;
let wsServer;
let port;
const clients = [];

const TEST_HOST = '127.0.0.1';

// --- NEW: Robust Client Helper with Message Buffering ---
const createClient = () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${port}`);

    // Buffer to hold messages arriving before test asks for them
    ws.messageBuffer = [];

    ws.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            ws.messageBuffer.push(parsed);
            // If a listener is waiting, notify it
            ws.emit('buffered_message', parsed);
        } catch (e) {
            console.error('Test JSON parse error:', e);
        }
    });

    clients.push(ws);

    return new Promise((resolve, reject) => {
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
    });
};

// --- NEW: Robust Message Waiter ---
const waitForMessage = (ws, type) => {
    return new Promise((resolve, reject) => {
        // 1. Check buffer immediately
        const bufferedIndex = ws.messageBuffer.findIndex(m => m.type === type);
        if (bufferedIndex !== -1) {
            const msg = ws.messageBuffer[bufferedIndex];
            // Remove this message and all before it (assume sequential consumption)
            ws.messageBuffer.splice(0, bufferedIndex + 1);
            return resolve(msg);
        }

        // 2. Setup timeout
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for message type: "${type}"`));
        }, 3000);

        // 3. Listen for new messages
        const listener = (msg) => {
            if (msg.type === type) {
                cleanup();
                resolve(msg);
            }
        };

        const cleanup = () => {
            clearTimeout(timeout);
            ws.off('buffered_message', listener);
        };

        ws.on('buffered_message', listener);
    });
};

describe('Signaling Service (WebSocket)', () => {
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
        state.clients.clear();
        for (const key in state.flights) delete state.flights[key];
        clients.forEach(c => {
            try { c.terminate(); } catch(e){}
        });
        clients.length = 0;
    });

    afterAll((done) => {
        closeConnections();
        server.close(done);
    });

    test('Client should connect and receive registration ID', async () => {
        const ws = await createClient();
        // This message is sent immediately by server, often before 'await createClient()' finishes.
        // The buffer handles this.
        const msg = await waitForMessage(ws, 'registered');
        expect(msg.id).toBeDefined();
    });

    test('Client should be able to register name', async () => {
        const ws = await createClient();
        await waitForMessage(ws, 'registered');

        ws.send(JSON.stringify({ type: 'register-details', name: 'TestUser' }));

        // Small delay to allow server to process
        await new Promise(r => setTimeout(r, 50));

        let foundName = null;
        for (const [key, val] of state.clients.entries()) {
            if (val.name === 'TestUser') foundName = val.name;
        }
        expect(foundName).toBe('TestUser');
    });

    test('Full Flight Flow: Create, Join, Signal', async () => {
        const host = await createClient();
        const joiner = await createClient();

        await waitForMessage(host, 'registered');
        host.send(JSON.stringify({ type: 'register-details', name: 'Host' }));

        await waitForMessage(joiner, 'registered');
        joiner.send(JSON.stringify({ type: 'register-details', name: 'Joiner' }));

        // Create
        host.send(JSON.stringify({ type: 'create-flight' }));
        const flightMsg = await waitForMessage(host, 'flight-created');
        const flightCode = flightMsg.flightCode;
        expect(flightCode).toHaveLength(6);

        // Join
        joiner.send(JSON.stringify({ type: 'join-flight', flightCode }));

        // Verify "peer-joined"
        const hostPeerMsg = await waitForMessage(host, 'peer-joined');
        const joinerPeerMsg = await waitForMessage(joiner, 'peer-joined');

        expect(hostPeerMsg.peer.name).toBe('Joiner');
        expect(joinerPeerMsg.peer.name).toBe('Host');

        // Signal
        const signalData = { sdp: 'mock-sdp-data' };
        host.send(JSON.stringify({ type: 'signal', data: signalData }));

        const signalReceived = await waitForMessage(joiner, 'signal');
        expect(signalReceived.data).toEqual(signalData);
    });

    test('Should reject joining with invalid code', async () => {
        const ws = await createClient();
        await waitForMessage(ws, 'registered');

        ws.send(JSON.stringify({ type: 'join-flight', flightCode: 'INVALID' }));
        const errorMsg = await waitForMessage(ws, 'error');
        expect(errorMsg.message).toMatch(/Invalid flight code|Flight not found/);
    });

    test('Should reject a 3rd user trying to join a full flight', async () => {
        const host = await createClient();
        const user2 = await createClient();
        const user3 = await createClient();

        // Setup Host
        await waitForMessage(host, 'registered');
        host.send(JSON.stringify({ type: 'register-details', name: 'Host' }));
        host.send(JSON.stringify({ type: 'create-flight' }));
        const flightMsg = await waitForMessage(host, 'flight-created');
        const code = flightMsg.flightCode;

        // User 2 Joins (Success)
        await waitForMessage(user2, 'registered');
        user2.send(JSON.stringify({ type: 'join-flight', flightCode: code }));
        await waitForMessage(user2, 'peer-joined');

        // User 3 Tries to Join (Should Fail)
        await waitForMessage(user3, 'registered');
        user3.send(JSON.stringify({ type: 'join-flight', flightCode: code }));

        const errorMsg = await waitForMessage(user3, 'error');
        expect(errorMsg.message).toMatch(/full/i); // Assuming your server returns "Flight full"
    });

    test('Should clean up flight if creator disconnects before join', async () => {
        const host = await createClient();
        await waitForMessage(host, 'registered');

        host.send(JSON.stringify({ type: 'create-flight' }));
        const msg = await waitForMessage(host, 'flight-created');
        const code = msg.flightCode;

        // Host leaves
        host.terminate();

        // Wait a moment for server to process close
        await new Promise(r => setTimeout(r, 100));

        // New user tries to join that code
        const joiner = await createClient();
        await waitForMessage(joiner, 'registered');
        joiner.send(JSON.stringify({ type: 'join-flight', flightCode: code }));

        const errorMsg = await waitForMessage(joiner, 'error');
        expect(errorMsg.message).toMatch(/not found/i);
    });

    test('Should disconnect or error if payload is too large', async () => {
        const ws = await createClient();
        await waitForMessage(ws, 'registered');

        // Create a string larger than 1MB (assuming config.MAX_PAYLOAD is around that)
        const hugeString = 'a'.repeat(1024 * 1024 * 2);

        ws.send(JSON.stringify({ type: 'signal', data: hugeString }));

        // Depending on your WS config, it might send an error frame or just close the socket
        // Let's check if the connection dies or sends an error
        try {
            const msg = await waitForMessage(ws, 'error');
            expect(msg.message).toMatch(/too large/i);
        } catch (e) {
            // If wait times out, check if socket is closed
            expect([ws.CLOSED, ws.CLOSING]).toContain(ws.readyState);
        }
    });

    test('Should broadcast users on the same network (Regression Test)', async () => {
        const user1 = await createClient();
        const user2 = await createClient();

        await waitForMessage(user1, 'registered');
        await waitForMessage(user2, 'registered');

        user1.send(JSON.stringify({ type: 'register-details', name: 'UserOne' }));

        // User 2 registers. This triggers broadcastUsersOnSameNetwork.
        // If the typo bug exists, the server throws silently and sends nothing.
        user2.send(JSON.stringify({ type: 'register-details', name: 'UserTwo' }));

        // We just need to verify that we actually receive the update message.
        // If the function crashes, this will timeout and fail the test.
        const msg = await waitForMessage(user1, 'users-on-network-update');

        expect(msg.users).toBeDefined();
        // Note: Depending on async timing, the list might contain UserTwo immediately or on a subsequent update.
        // The critical check here is that the message is sent at all (proving no crash).
    });
});