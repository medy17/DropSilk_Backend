// tests/uploadthing.test.js
const httpMocks = require('node-mocks-http');

// --- Polyfill Globals (Request/Response/Headers) if missing in Jest env ---
if (!global.Request) {
    global.Request = class Request {
        constructor(url, options) {
            this.url = url;
            this.method = options.method || 'GET';
            this.headers = options.headers || new Headers();
            this.body = options.body;
        }
        async arrayBuffer() { return Buffer.from(''); }
    };
}
if (!global.Response) {
    global.Response = class Response {
        constructor(body, options) {
            this.status = options.status || 200;
            this.headers = new Headers(options.headers);
            this._body = body;
        }
        async arrayBuffer() { return Buffer.from(this._body || ''); }
    };
}
if (!global.Headers) {
    global.Headers = class Headers {
        constructor(init) {
            this.map = new Map();
            if (init && typeof init === 'object') {
                Object.entries(init).forEach(([k, v]) => this.append(k, v));
            }
        }
        append(k, v) { this.map.set(k.toLowerCase(), v); }
        set(k, v) { this.map.set(k.toLowerCase(), v); }
        get(k) { return this.map.get(k.toLowerCase()); }
        forEach(cb) { this.map.forEach((v, k) => cb(v, k, this)); }
        [Symbol.iterator]() { return this.map.entries(); }
    };
}

// 1. Mock Config
jest.mock('../src/config', () => ({
    UPLOADTHING_TOKEN: 'sk_live_mock_token_12345',
    PORT: 3000
}));

// 2. Mock Database
jest.mock('../src/dbClient', () => ({
    isDatabaseInitialized: jest.fn(() => true),
    query: jest.fn()
}));

// 3. Mock Utils (Spy on log to see errors)
const mockLog = jest.fn();
jest.mock('../src/utils', () => ({
    log: mockLog
}));

// 4. Mock UploadThing/Server logic
const mockHandler = jest.fn((req) => {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
});

jest.mock('uploadthing/server', () => ({
    createUploadthing: () => () => ({
        middleware: () => ({
            onUploadComplete: () => ({})
        })
    }),
    createRouteHandler: () => mockHandler,
    UTApi: jest.fn()
}));

// Import after mocks
const { handleUploadThingRequest } = require('../src/uploadthingHandler');

describe('UploadThing Handler', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Should handle OPTIONS request (CORS Preflight)', async () => {
        const req = httpMocks.createRequest({
            method: 'OPTIONS',
            headers: { origin: 'http://localhost:3000' }
        });
        const res = httpMocks.createResponse();

        await handleUploadThingRequest(req, res);

        expect(res.statusCode).toBe(204);
        expect(res.getHeader('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });

    test('Should set CORS headers on normal requests', async () => {
        const req = httpMocks.createRequest({
            method: 'POST',
            url: '/api/uploadthing',
            headers: {
                origin: 'https://dropsilk.xyz',
                // FIX: Host is required for URL construction
                host: 'localhost:3000'
            }
        });

        // Mock async iterator for body reading
        req[Symbol.asyncIterator] = async function* () { yield Buffer.from('test'); };

        const res = httpMocks.createResponse();

        await handleUploadThingRequest(req, res);

        expect(res.getHeader('Access-Control-Allow-Origin')).toBe('https://dropsilk.xyz');
    });

    test('Should initialize handler if token is present', async () => {
        const req = httpMocks.createRequest({
            method: 'GET',
            url: '/api/uploadthing',
            headers: {
                // FIX: Host is required here too
                host: 'localhost:3000'
            }
        });

        req[Symbol.asyncIterator] = async function* () { yield Buffer.from(''); };

        const res = httpMocks.createResponse();

        await handleUploadThingRequest(req, res);

        // Check if any errors were logged (helps debugging if test fails)
        const errorLogs = mockLog.mock.calls.filter(call => call[0] === 'error');
        if (errorLogs.length > 0) {
            console.error("🚨 Logged Errors during test:", JSON.stringify(errorLogs, null, 2));
        }

        // Verify that the route handler was created and called
        expect(mockHandler).toHaveBeenCalled();
    });
});