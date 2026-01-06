// --- src/uploadthingHandler.js ---

const config = require("./config");
const db = require("./dbClient");
const { emit } = require("./gossamer");

let utRequestHandler = null;

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
                emit("upload:success", {
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

                        emit("upload:db_saved", { key: file.key });
                    } catch (dbError) {
                        emit("upload:error", {
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
        emit("upload:error", {
            context: "Handler Route Error",
            error: err.message,
        });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "UploadThing routing error" }));
    }
}

module.exports = { handleUploadThingRequest };