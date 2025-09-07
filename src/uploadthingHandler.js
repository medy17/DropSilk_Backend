// --- src/uploadthingHandler.js ---
// This is the final, corrected backend file.

const { log } = require("./utils");
const config = require("./config");

let utRequestHandler = null;

async function getUtRequestHandler() {
    if (utRequestHandler) return utRequestHandler;

    if (!config.UPLOADTHING_TOKEN) {
        throw new Error("Missing UPLOADTHING_TOKEN in config.js (from environment variable)");
    }

    const { createUploadthing } = await import("uploadthing/server");
    const { createRouteHandler } = await import("uploadthing/fetch");

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
                // This log message is your proof that the fix is working.
                log("info", "✅ UploadThing onUploadComplete SUCCESS", { url: file.url });
                return { url: file.url };
            }),
    };

    // --- START: THE FINAL FIX ---
    // Use the explicit public URL from your environment variables for production,
    // and fallback to localhost for local development.
    const callbackUrl = process.env.PUBLIC_SERVER_URL
        ? `${process.env.PUBLIC_SERVER_URL}/api/uploadthing`
        : `http://localhost:${config.PORT}/api/uploadthing`;

    utRequestHandler = createRouteHandler({
        router,
        config: {
            token: config.UPLOADTHING_TOKEN,
            /**
             * This now correctly points to https://dropsilk.xyz/api/uploadthing
             * in production, solving the webhook problem.
             */
            callbackUrl: callbackUrl,
            logLevel: "debug",
        },
    });

    log("info", "UploadThing handler configured", { callbackUrl: callbackUrl });
    // --- END: THE FINAL FIX ---

    return utRequestHandler;
}


async function nodeToWebRequest(req) {
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

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
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

// --- AFTER THE FIX ---
// --- THE FINAL, PERMANENT FIX ---
function setCors(res, origin) {
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    // Allow any headers sent from the trusted origin. This stops the whack-a-mole game.
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
    } catch (err) {
        log("error", "UploadThing route error", { error: err.message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "UploadThing routing error" }));
    }
}

module.exports = { handleUploadThingRequest };