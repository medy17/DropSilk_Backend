// --- src/emailService.ts ---

import type { IncomingMessage, ServerResponse } from "http";
import axios from "axios";
import config from "./config";
import { eventBus, EVENTS } from "./telemetry";

// Define a type for the request to avoid 'any'
interface EmailRequest extends IncomingMessage {
    body?: {
        token?: string;
    };
}

function sendJson(res: ServerResponse, statusCode: number, obj: object) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
}

export async function handleRequestEmail(
    req: EmailRequest,
    res: ServerResponse,
) {
    try {
        const { token } = req.body || {};

        if (!token) {
            return sendJson(res, 400, { error: "reCAPTCHA token is required" });
        }

        eventBus.emit(EVENTS.EMAIL.REQUEST, { status: "validating" });

        const response = await axios.post(
            "https://www.google.com/recaptcha/api/siteverify",
            null,
            {
                params: {
                    secret: config.recaptchaSecretKey,
                    response: token,
                },
            },
        );

        const { success } = response.data || {};

        if (success) {
            if (!config.contactEmail) {
                eventBus.emit(EVENTS.EMAIL.ERROR, {
                    error: "server_not_configured",
                });
                return sendJson(res, 500, {
                    error: "server_not_configured",
                });
            }
            return sendJson(res, 200, { email: config.contactEmail });
        }

        return sendJson(res, 400, { error: "recaptcha_failed" });
    } catch (error: any) {
        eventBus.emit(EVENTS.EMAIL.ERROR, {
            context: "reCAPTCHA verification failed",
            error: error.message,
            axiosResponse: error.response?.data,
        });
        return sendJson(res, 500, { error: "internal_error" });
    }
}