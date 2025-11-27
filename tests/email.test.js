// --- tests/email.test.js ---
const axios = require("axios");
const httpMocks = require("node-mocks-http");
const { handleRequestEmail } = require("../src/emailService");

// Mock dependencies
jest.mock("axios");
jest.mock("../src/config", () => ({
    recaptchaSecretKey: "mock-secret-key",
    contactEmail: "admin@example.com",
}));

// Mock the telemetry event bus
// Define the mock inside the factory to avoid hoisting issues
jest.mock("../src/telemetry", () => ({
    eventBus: {
        emit: jest.fn(),
    },
    EVENTS: jest.requireActual("../src/telemetry/events"),
}));
// Get a reference to the mock function AFTER the mock is in place
const { eventBus, EVENTS } = require("../src/telemetry");
const mockEmit = eventBus.emit;

describe("Email Service", () => {
    beforeEach(() => {
        mockEmit.mockClear();
    });

    test("Should return 400 if token is missing", async () => {
        const req = httpMocks.createRequest({
            method: "POST",
            url: "/request-email",
            body: {},
        });
        const res = httpMocks.createResponse();

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res._getData())).toEqual({
            error: "reCAPTCHA token is required",
        });
    });

    test("Should emit REQUEST event when validating", async () => {
        const req = httpMocks.createRequest({
            method: "POST",
            url: "/request-email",
            body: { token: "any-token" },
        });
        const res = httpMocks.createResponse();

        axios.post.mockResolvedValue({ data: { success: false } });

        await handleRequestEmail(req, res);

        expect(mockEmit).toHaveBeenCalledWith(EVENTS.EMAIL.REQUEST, {
            status: "validating",
        });
    });

    test("Should return 200 and email if reCAPTCHA succeeds", async () => {
        const req = httpMocks.createRequest({
            method: "POST",
            url: "/request-email",
            body: { token: "valid-token" },
        });
        const res = httpMocks.createResponse();

        axios.post.mockResolvedValue({ data: { success: true } });

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res._getData())).toEqual({
            email: "admin@example.com",
        });
    });

    test("Should emit ERROR and return 500 if Google API errors out", async () => {
        const req = httpMocks.createRequest({
            method: "POST",
            url: "/request-email",
            body: { token: "valid-token" },
        });
        const res = httpMocks.createResponse();

        const apiError = new Error("Network Error");
        axios.post.mockRejectedValue(apiError);

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res._getData())).toEqual({ error: "internal_error" });

        // Verify that the correct telemetry event was emitted
        expect(mockEmit).toHaveBeenCalledWith(EVENTS.EMAIL.ERROR, {
            context: "reCAPTCHA verification failed",
            error: "Network Error",
            axiosResponse: undefined,
        });
    });

    test("Should emit ERROR if contactEmail is not configured", async () => {
        const config = require("../src/config");
        config.contactEmail = ""; // Temporarily unset for this test

        const req = httpMocks.createRequest({
            method: "POST",
            url: "/request-email",
            body: { token: "valid-token" },
        });
        const res = httpMocks.createResponse();

        axios.post.mockResolvedValue({ data: { success: true } });
        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(500);
        expect(mockEmit).toHaveBeenCalledWith(EVENTS.EMAIL.ERROR, {
            error: "server_not_configured",
        });

        config.contactEmail = "admin@example.com"; // Restore
    });
});