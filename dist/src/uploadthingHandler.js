"use strict";
// --- src/uploadthingHandler.ts ---
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUploadThingRequest = handleUploadThingRequest;
const config_1 = __importDefault(require("./config"));
const db = __importStar(require("./dbClient"));
const gossamer_1 = require("./gossamer");
let utRequestHandler = null;
async function getUtRequestHandler() {
    if (utRequestHandler)
        return utRequestHandler;
    if (!config_1.default.UPLOADTHING_TOKEN) {
        throw new Error("Missing UPLOADTHING_TOKEN in config.js");
    }
    const { createUploadthing, createRouteHandler } = await Promise.resolve().then(() => __importStar(require("uploadthing/server")));
    const f = createUploadthing();
    const router = {
        previewUpload: f({
            "application/vnd.openxmlformats-officedocument.presentationml.presentation": { maxFileSize: "64MB", maxFileCount: 1 },
        })
            .middleware(async () => {
            return { uploadedBy: "dropsilk-preview" };
        })
            .onUploadComplete(async ({ file }) => {
            (0, gossamer_1.emit)("upload:success", {
                url: file.url,
                key: file.key,
            });
            if (db.isDatabaseInitialized()) {
                try {
                    const insertQuery = `
                            INSERT INTO uploaded_files (file_key, file_url, file_name)
                            VALUES ($1, $2, $3)
                        `;
                    await db.query(insertQuery, [
                        file.key,
                        file.url,
                        file.name,
                    ]);
                    (0, gossamer_1.emit)("upload:db_saved", { key: file.key });
                }
                catch (dbError) {
                    const err = dbError;
                    (0, gossamer_1.emit)("upload:error", {
                        context: "DB Save Failed",
                        key: file.key,
                        error: err.message,
                    });
                }
            }
            return { url: file.url };
        }),
    };
    const callbackUrl = process.env.PUBLIC_SERVER_URL
        ? `${process.env.PUBLIC_SERVER_URL}/api/uploadthing`
        : `http://localhost:${config_1.default.PORT}/api/uploadthing`;
    utRequestHandler = createRouteHandler({
        router,
        config: {
            token: config_1.default.UPLOADTHING_TOKEN,
            callbackUrl: callbackUrl,
        },
    });
    return utRequestHandler;
}
async function nodeToWebRequest(req) {
    const url = `http://${req.headers.host}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined)
            continue;
        headers.set(k, Array.isArray(v) ? v.join(",") : v);
    }
    const method = req.method || "GET";
    if (method === "GET" || method === "HEAD") {
        return new Request(url, { method, headers });
    }
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    return new Request(url, { method, headers, body });
}
async function sendWebResponse(res, response) {
    const headersObj = {};
    response.headers.forEach((val, key) => {
        headersObj[key] = val;
    });
    res.writeHead(response.status, headersObj);
    const arrayBuf = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuf));
}
function setCors(res, origin) {
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Max-Age", "86400");
}
async function handleUploadThingRequest(req, res) {
    try {
        if (req.method === "OPTIONS") {
            setCors(res, req.headers.origin);
            res.writeHead(204);
            res.end();
            return;
        }
        setCors(res, req.headers.origin);
        const handler = await getUtRequestHandler();
        const webReq = await nodeToWebRequest(req);
        const webRes = await handler(webReq);
        await sendWebResponse(res, webRes);
    }
    catch (err) {
        const error = err;
        (0, gossamer_1.emit)("upload:error", {
            context: "Handler Route Error",
            error: error.message,
        });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "UploadThing routing error" }));
    }
}
//# sourceMappingURL=uploadthingHandler.js.map