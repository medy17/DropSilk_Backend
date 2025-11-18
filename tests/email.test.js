// tests/email.test.js
const axios = require('axios');
const httpMocks = require('node-mocks-http');
const { handleRequestEmail } = require('../src/emailService');

// Mock dependencies
jest.mock('axios');
jest.mock('../src/config', () => ({
    recaptchaSecretKey: 'mock-secret-key',
    contactEmail: 'admin@example.com'
}));

describe('Email Service', () => {

    // --- NEW: Silence console.error before tests run ---
    beforeAll(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    // --- NEW: Restore console.error after tests finish ---
    afterAll(() => {
        console.error.mockRestore();
    });

    test('Should return 400 if token is missing', async () => {
        const req = httpMocks.createRequest({
            method: 'POST',
            body: {}
        });
        const res = httpMocks.createResponse();

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res._getData())).toEqual({ error: 'reCAPTCHA token is required' });
    });

    test('Should return 400 if reCAPTCHA verification fails', async () => {
        const req = httpMocks.createRequest({
            method: 'POST',
            body: { token: 'invalid-token' }
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
            body: { token: 'valid-token' }
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
            body: { token: 'valid-token' }
        });
        const res = httpMocks.createResponse();

        // Mock Network Error
        axios.post.mockRejectedValue(new Error('Network Error'));

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res._getData())).toEqual({ error: 'internal_error' });

        // Optional: Verify that console.error WAS called (even though we hid it)
        expect(console.error).toHaveBeenCalled();
    });
});