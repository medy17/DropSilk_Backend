// --- tests/email.test.js ---
const httpMocks = require("node-mocks-http");

// Mock axios with explicit default export structure for ESM interop
jest.mock("axios", () => ({
    __esModule: true,
    default: {
        post: jest.fn(),
    },
}));

const axios = require("axios").default;

jest.mock("../src/config", () => ({
    __esModule: true,
    default: {
        recaptchaSecretKey: "mock-secret-key",
        contactEmail: "admin@example.com",
    },
}));

// Mock the Gossamer emit
const mockEmit = jest.fn();
jest.mock("../src/gossamer", () => ({
    emit: mockEmit,
}));

const { handleRequestEmail } = require("../src/emailService");

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

    test("Should emit email:request event when validating", async () => {
        const req = httpMocks.createRequest({
            method: "POST",
            url: "/request-email",
            body: { token: "any-token" },
        });
        const res = httpMocks.createResponse();

        axios.post.mockResolvedValue({ data: { success: false } });

        await handleRequestEmail(req, res);

        expect(mockEmit).toHaveBeenCalledWith("email:request", {
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

    test("Should emit email:error and return 500 if Google API errors out", async () => {
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
        expect(mockEmit).toHaveBeenCalledWith("email:error", {
            context: "reCAPTCHA verification failed",
            error: "Network Error",
            axiosResponse: undefined,
        });
    });

    test("Should emit email:error if contactEmail is not configured", async () => {
        const config = require("../src/config").default;
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
        expect(mockEmit).toHaveBeenCalledWith("email:error", {
            error: "server_not_configured",
        });

        config.contactEmail = "admin@example.com"; // Restore
    });
});