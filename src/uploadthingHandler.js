// --- src/uploadthingHandler.js ---
const { log } = require("./utils");
const config = require("./config");

let utRequestHandler = null;

async function getUtRequestHandler() {
    if (utRequestHandler) return utRequestHandler;

    // Updated check for the new token
    if (!config.UPLOADTHING_TOKEN) {
        throw new Error("Missing UPLOADTHING_TOKEN environment variable");
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
                log("info", "UploadThing onUploadComplete", { url: file.url });
                return { url: file.url };
            }),
    };

    // The handler automatically reads the UPLOADTHING_TOKEN from the environment
    utRequestHandler = createRouteHandler({ router });
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

function setCors(res, origin) {
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "content-type,authorization,x-uploadthing-version,x-uploadthing-language"
    );
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