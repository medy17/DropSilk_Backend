"use strict";
// --- src/emailService.ts ---
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRequestEmail = handleRequestEmail;
const axios_1 = __importDefault(require("axios"));
const config_1 = __importDefault(require("./config"));
const gossamer_1 = require("./gossamer");
function sendJson(res, statusCode, obj) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
}
async function handleRequestEmail(req, res) {
    try {
        const { token } = req.body || {};
        if (!token) {
            sendJson(res, 400, { error: "reCAPTCHA token is required" });
            return;
        }
        (0, gossamer_1.emit)("email:request", { status: "validating" });
        const response = await axios_1.default.post("https://www.google.com/recaptcha/api/siteverify", null, {
            params: {
                secret: config_1.default.recaptchaSecretKey,
                response: token,
            },
        });
        const { success } = response.data || {};
        if (success) {
            if (!config_1.default.contactEmail) {
                (0, gossamer_1.emit)("email:error", { error: "server_not_configured" });
                sendJson(res, 500, { error: "server_not_configured" });
                return;
            }
            sendJson(res, 200, { email: config_1.default.contactEmail });
            return;
        }
        sendJson(res, 400, { error: "recaptcha_failed" });
    }
    catch (error) {
        const err = error;
        (0, gossamer_1.emit)("email:error", {
            context: "reCAPTCHA verification failed",
            error: err.message,
            axiosResponse: err.response?.data,
        });
        sendJson(res, 500, { error: "internal_error" });
    }
}
//# sourceMappingURL=emailService.js.map