import axios from "axios";
import httpMocks from "node-mocks-http";
import { handleRequestEmail } from "@src/emailService";

jest.mock("axios");
jest.mock("@src/config", () => ({
    recaptchaSecretKey: "mock-secret-key",
    contactEmail: "admin@example.com",
}));

// Mock the telemetry index (SUT uses @src/telemetry)
jest.mock("@src/telemetry", () => {
    const realEvents = jest.requireActual("@src/telemetry/events").default;
    return {
        __esModule: true,
        EVENTS: realEvents,
        eventBus: { emit: jest.fn() },
    };
});

import { eventBus, EVENTS } from "@src/telemetry";
const mockedAxiosPost = axios.post as jest.Mock;
const mockEmit = eventBus.emit as jest.Mock;
const config = require("@src/config");

describe("Email Service", () => {
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

        mockedAxiosPost.mockResolvedValue({ data: { success: false } });

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

        mockedAxiosPost.mockResolvedValue({ data: { success: true } });

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
        mockedAxiosPost.mockRejectedValue(apiError);

        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res._getData())).toEqual({
            error: "internal_error",
        });

        expect(mockEmit).toHaveBeenCalledWith(EVENTS.EMAIL.ERROR, {
            context: "reCAPTCHA verification failed",
            error: "Network Error",
            axiosResponse: undefined,
        });
    });

    test("Should emit ERROR if contactEmail is not configured", async () => {
        config.contactEmail = "";

        const req = httpMocks.createRequest({
            method: "POST",
            url: "/request-email",
            body: { token: "valid-token" },
        });
        const res = httpMocks.createResponse();

        mockedAxiosPost.mockResolvedValue({ data: { success: true } });
        await handleRequestEmail(req, res);

        expect(res.statusCode).toBe(500);
        expect(mockEmit).toHaveBeenCalledWith(EVENTS.EMAIL.ERROR, {
            error: "server_not_configured",
        });

        config.contactEmail = "admin@example.com";
    });
});