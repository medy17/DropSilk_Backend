// tests/http.test.js
const request = require('supertest');

jest.mock('../src/config', () => ({
    PORT: 0,
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: new Set(['http://localhost']),
    VERCEL_PREVIEW_ORIGIN_REGEX: /^https:\/\/.*\.vercel\.app$/,
    LOG_ACCESS_KEY: 'test-secret',
    CLOUDFLARE_TURN_TOKEN_ID: 'fake-id',
    CLOUDFLARE_API_TOKEN: 'fake-token',
    NO_DB: true
}));

jest.mock('../src/uploadthingHandler', () => ({
    handleUploadThingRequest: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    }
}));

jest.mock('../src/dbClient', () => ({
    isDatabaseInitialized: () => false,
    query: jest.fn()
}));

const { server } = require('../src/httpServer');

describe('HTTP Server Endpoints', () => {

    // Close server after all tests are done to prevent "Jest did not exit"
    afterAll((done) => {
        if (server.listening) {
            server.close(done);
        } else {
            done();
        }
    });

    test('GET / should return health check message', async () => {
        const res = await request(server).get('/');
        expect(res.statusCode).toEqual(200);
        expect(res.text).toContain('Server is alive');
    });

    test('GET /stats should return JSON stats', async () => {
        const res = await request(server).get('/stats');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('activeConnections');
    });

    test('GET /logs should be forbidden without key', async () => {
        const res = await request(server).get('/logs');
        expect(res.statusCode).toEqual(403);
    });

    test('GET /logs should work with correct key', async () => {
        const res = await request(server).get('/logs?key=test-secret');
        expect(res.statusCode).toEqual(200);
    });

    test('GET /api/turn-credentials should handle upstream API failure', async () => {
        // Override the fetch mock for THIS test only
        global.fetch = jest.fn(() => Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Cloudflare Down')
        }));

        const res = await request(server).get('/api/turn-credentials');
        expect(res.statusCode).toEqual(500); // Or whatever your error handling logic returns
        expect(res.body).toHaveProperty('error');
    });
});