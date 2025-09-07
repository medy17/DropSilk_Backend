// --- src/uploadthingHandler.js ---
// This is your BACKEND file. This is where the fix goes.

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
                // This log message is the proof that the fix is working.
                log("info", "✅ UploadThing onUploadComplete SUCCESS", { url: file.url });
                return { url: file.url };
            }),
    };

    // Use the explicit public URL from your environment variables.
    const callbackUrl = process.env.PUBLIC_SERVER_URL
        ? `${process.env.PUBLIC_SERVER_URL}/api/uploadthing`
        : `http://localhost:${config.PORT}/api/uploadthing`; // Fallback for local dev

    utRequestHandler = createRouteHandler({
        router,
        config: {
            token: config.UPLOADTHING_TOKEN,
            /**
             * This now correctly points to your custom domain, solving the webhook issue.
             */
            callbackUrl: callbackUrl,
            logLevel: "debug",
        },
    });

    log("info", "UploadThing handler configured", { callbackUrl: callbackUrl });

    return utRequestHandler;
}

// ... the rest of the file remains the same ...
// No other changes are needed in this file.

async function nodeToWebRequest(req) { /* ... */ }
async function sendWebResponse(res, response) { /* ... */ }
function setCors(res, origin) { /* ... */ }
async function handleUploadThingRequest(req, res) { /* ... */ }

module.exports = { handleUploadThingRequest };