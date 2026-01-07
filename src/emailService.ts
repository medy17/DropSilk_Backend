// --- src/emailService.ts ---

import axios from "axios";
import type { ServerResponse, IncomingMessage } from "http";
import config from "./config";
import { emit } from "./gossamer";

interface EmailRequestBody {
    token?: string;
}

interface IncomingMessageWithBody extends IncomingMessage {
    body?: EmailRequestBody;
}

function sendJson(res: ServerResponse, statusCode: number, obj: Record<string, unknown>): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
}

export async function handleRequestEmail(
    req: IncomingMessageWithBody,
    res: ServerResponse
): Promise<void> {
    try {
        const { token } = req.body || {};

        if (!token) {
            sendJson(res, 400, { error: "reCAPTCHA token is required" });
            return;
        }

        emit("email:request", { status: "validating" });

        const response = await axios.post(
            "https://www.google.com/recaptcha/api/siteverify",
            null,
            {
                params: {
                    secret: config.recaptchaSecretKey,
                    response: token,
                },
            }
        );

        const { success } = response.data || {};

        if (success) {
            if (!config.contactEmail) {
                emit("email:error", { error: "server_not_configured" });
                sendJson(res, 500, { error: "server_not_configured" });
                return;
            }
            sendJson(res, 200, { email: config.contactEmail });
            return;
        }

        sendJson(res, 400, { error: "recaptcha_failed" });
    } catch (error) {
        const err = error as Error & { response?: { data?: unknown } };
        emit("email:error", {
            context: "reCAPTCHA verification failed",
            error: err.message,
            axiosResponse: err.response?.data,
        });
        sendJson(res, 500, { error: "internal_error" });
    }
}
