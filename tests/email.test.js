// tests/email.test.js
const axios = require('axios');
const httpMocks = require('node-mocks-http');
const { handleRequestEmail } = require('../src/emailService');
const { log } = require('../src/utils'); // <-- Import the log function

// Mock dependencies
jest.mock('axios');
jest.mock('../src/config', () => ({
    recaptchaSecretKey: 'mock-secret-key',
    contactEmail: 'admin@example.com'
}));
// We will mock 'utils' to spy on the log function
jest.mock('../src/utils', () => ({
    log: jest.fn()
}));

describe('Email Service', () => {

    // Clear mocks before each test to ensure a clean slate
    beforeEach(() => {
        log.mockClear();
    });

    test('Should return 400 if token is missing', async () => {
        const req = httpMocks.createRequest({
            method: 'POST',
            url: '/request-email',
            body: {},
        });
        const res = httpMocks.createResponse();

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res._getData())).toEqual({ error: 'reCAPTCHA token is required' });
    });

    test('Should return 400 if reCAPTCHA verification fails', async () => {
        const req = httpMocks.createRequest({
            method: 'POST',
            url: '/request-email',
            body: { token: 'invalid-token' },
        });
        const res = httpMocks.createResponse();

        axios.post.mockResolvedValue({ data: { success: false } });

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res._getData())).toEqual({ error: 'recaptcha_failed' });
    });

    test('Should return 200 and email if reCAPTCHA succeeds', async () => {
        const req = httpMocks.createRequest({
            method: 'POST',
            url: '/request-email',
            body: { token: 'valid-token' },
        });
        const res = httpMocks.createResponse();

        axios.post.mockResolvedValue({ data: { success: true } });

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res._getData())).toEqual({ email: 'admin@example.com' });
    });

    test('Should return 500 if Google API errors out', async () => {
        const req = httpMocks.createRequest({
            method: 'POST',
            url: '/request-email',
            body: { token: 'valid-token' },
        });
        const res = httpMocks.createResponse();

        // Mock Network Error
        axios.post.mockRejectedValue(new Error('Network Error'));

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res._getData())).toEqual({ error: 'internal_error' });

        // --- THE FIX ---
        // Verify that our structured logger was called with 'error'
        expect(log).toHaveBeenCalledWith(
            'error',
            expect.any(String), // We don't care about the exact message
            expect.any(Object)   // We just care that it was called correctly
        );
    });
});