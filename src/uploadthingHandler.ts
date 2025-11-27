// --- src/uploadthingHandler.ts ---

import config from "./config";
import db from "./dbClient";
import { eventBus, EVENTS } from "./telemetry";
// REMOVED the `next` import that was causing errors
import type { IncomingMessage, ServerResponse } from "http";

let utRequestHandler: ((req: Request) => Promise<Response>) | null = null;

async function getUtRequestHandler() {
    if (utRequestHandler) return utRequestHandler;

    if (!config.UPLOADTHING_TOKEN) {
        throw new Error("Missing UPLOADTHING_TOKEN in config.js");
    }

    const { createUploadthing, createRouteHandler } = await import(
        "uploadthing/server"
        );

    const f = createUploadthing();

    const router = {
        previewUpload: f({
            "application/vnd.openxmlformats-officedocument.presentationml.presentation":
                { maxFileSize: "64MB", maxFileCount: 1 },
        })
            .middleware(async () => {
                return { uploadedBy: "dropsilk-preview" };
            })
            .onUploadComplete(async ({ file }) => {
                eventBus.emit(EVENTS.UPLOAD.SUCCESS, {
                    url: file.url,
                    key: file.key,
                });

                if (db.isDatabaseInitialized()) {
                    try {
                        // Note: This SQL warning is from your IDE, not TypeScript. It's safe to ignore.
                        const insertQuery = `
                            INSERT INTO uploaded_files (file_key, file_url, file_name)
                            VALUES ($1, $2, $3)
                        `;
                        await db.query(insertQuery, [
                            file.key,
                            file.url,
                            file.name,
                        ]);

                        eventBus.emit(EVENTS.UPLOAD.DB_SAVED, { key: file.key });
                    } catch (dbError: any) {
                        eventBus.emit(EVENTS.UPLOAD.ERROR, {
                            context: "DB Save Failed",
                            key: file.key,
                            error: dbError.message,
                        });
                    }
                }
                return { url: file.url };
            }),
    };

    const callbackUrl = process.env.PUBLIC_SERVER_URL
        ? `${process.env.PUBLIC_SERVER_URL}/api/uploadthing`
        : `http://localhost:${config.PORT}/api/uploadthing`;

    utRequestHandler = createRouteHandler({
        router,
        config: {
            token: config.UPLOADTHING_TOKEN,
            callbackUrl: callbackUrl,
        },
    });

    return utRequestHandler;
}

async function nodeToWebRequest(req: IncomingMessage): Promise<Request> {
    const url = `http://${req.headers.host}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        headers.set(k, Array.isArray(v) ? v.join(",") : v);
    }

    const method = req.method || "GET";
    if (method === "GET" || method === "HEAD") {
        return new Request(url, { method, headers });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    return new Request(url, { method, headers, body });
}

async function sendWebResponse(res: ServerResponse, response: Response) {
    const headersObj: Record<string, string> = {};
    response.headers.forEach((val, key) => {
        headersObj[key] = val;
    });
    res.writeHead(response.status, headersObj);

    const arrayBuf = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuf));
}

function setCors(res: ServerResponse, origin: string | undefined) {
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Max-Age", "86400");
}

async function handleUploadThingRequest(
    req: IncomingMessage,
    res: ServerResponse,
) {
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
        // --- THIS IS THE CORRECTED PART ---
        // Removed the redundant 'await' because handler() is synchronous
        const webRes = handler(webReq);
        await sendWebResponse(res, await webRes);
    } catch (err: any) {
        eventBus.emit(EVENTS.UPLOAD.ERROR, {
            context: "Handler Route Error",
            error: err.message,
        });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "UploadThing routing error" }));
    }
}

export { handleUploadThingRequest };