<div align="center">
  <img src="https://raw.githubusercontent.com/medy17/dropsilk/refs/heads/main/frontend/public/logo.webp" alt="DropSilk Logo" width="100" />
  <h1>DropSilk - Backend Signaling Server</h1>
  <p>
    The lightweight, in-memory signaling and API server for the <a href="https://github.com/medy17/dropsilk">DropSilk</a> project.
  </p>

  <div>
    <img src="https://img.shields.io/badge/Node.js-^22-339933?style=for-the-badge&logo=node.js" alt="Node.js version"/>
    <img src="https://img.shields.io/github/license/medy17/dropsilk_backend?style=for-the-badge" alt="License"/>
  </div>
</div>

## Overview

This repository contains the backend service for DropSilk. Its primary role
is to act as a WebRTC signaling server, also known as a "rendezvous" or
"matchmaking" service. It uses WebSockets to help two DropSilk clients find
each other and exchange the necessary metadata to establish a direct,
peer-to-peer connection.

Crucially, this server does not handle any file transfers. All files and
screen-sharing data are sent directly between the connected peers, ensuring
privacy and speed.

Additionally, this server provides a small set of HTTP endpoints for health
checks, statistics, and a secure proxy for the UploadThing API, which
facilitates file previews for formats like `.pptx`.

The server stores minimal metadata about preview uploads in
PostgreSQL and runs a background cleanup service that periodically removes
stale preview files from UploadThing and prunes their database records. This
keeps storage lean and prevents orphaned files. It's also relevant for compliance
with data retention and privacy laws. Running the database is ultimately optional
and can be bypassed via an argument.

### Core Features

- WebSocket-based real-time signaling: Manages client connections,
  disconnections, and the exchange of WebRTC session descriptions (SDP) and
  ICE candidates.
- Flight management: Handles the creation of unique, temporary "flight codes"
  and allows peers to join these flights.
- Peer discovery & LAN/WAN detection: Intelligently groups users on the same
  network (by public IP or private subnet) and informs the clients if a
  faster LAN connection is possible.
- HTTP API endpoints:
    - GET /: Health check.
    - GET /stats: Real-time server statistics.
    - GET /logs: A secure, key-protected endpoint to view recent in-memory
      server logs for debugging.
    - GET /keep-alive: Lightweight ping endpoint.
- Secure upload endpoint: Provides a route (`/api/uploadthing`) that securely
  handles authentication and requests for the UploadThing service, used for
  generating file previews on the frontend.
- Robust security & CORS: Implements strict origin validation to ensure only
  trusted frontend clients can connect. Includes support for Vercel preview
  deployments.
- Graceful shutdown: Ensures clean termination of connections and processes
  when the server is stopped or restarted.
- In-memory logging: Keeps a running buffer of the most recent log events,
  accessible via the `/logs` endpoint for easy debugging without writing to
  disk.
- Automated preview cleanup service: Periodically deletes old preview files
  from UploadThing and removes their associated database records. By default,
  files older than 24 hours are considered stale. The job runs once at
  startup and then on a schedule (every 60 minutes in this repo's default
  `server.js`).

## API & Signaling Protocol

The server communicates with clients primarily over WebSockets using a
simple JSON-based protocol.

### WebSocket Messages (Client ↔ Server)

| Type                      | Direction  | Description                                                                                                       |
|:--------------------------|:-----------|:------------------------------------------------------------------------------------------------------------------|
| `registered`              | S → C      | Sent by the server to a new client, providing their unique session ID.                                            |
| `register-details`        | C → S      | Client sends its generated name to the server.                                                                    |
| `users-on-network-update` | S → C      | Server sends a list of other available users on the same network.                                                 |
| `create-flight`           | C → S      | Client requests the server to create a new private session ("flight").                                            |
| `flight-created`          | S → C      | Server responds with the unique 6-character flight code.                                                          |
| `join-flight`             | C → S      | Client requests to join an existing flight using a code.                                                          |
| `peer-joined`             | S → C      | Server notifies both peers a connection is established, including peer info and connection type (`lan` or `wan`). |
| `peer-left`               | S → C      | Server notifies a client that their peer has disconnected.                                                        |
| `invite-to-flight`        | C → S      | A client in a flight invites another user on the network to join.                                                 |
| `flight-invitation`       | S → C      | Server forwards the invitation to the target user.                                                                |
| `signal`                  | C ↔ S ↔ C  | WebRTC signaling data (SDP/ICE) to be forwarded to its peer.                                                      |
| `error`                   | S → C      | Server sends an error message (e.g., "Flight not found").                                                         |

### HTTP Endpoints

| Method | Path               | Description                                                                  |
|:-------|:-------------------|:-----------------------------------------------------------------------------|
| GET    | `/`                | Basic health check endpoint. Returns a simple text response.                 |
| GET    | `/stats`           | Returns a JSON object with server statistics (uptime, memory, connections).  |
| GET    | `/logs?key=...`    | Returns plain text dump of recent in-memory logs. Requires `LOG_ACCESS_KEY`. |
| GET    | `/keep-alive`      | Lightweight ping endpoint for uptime checks.                                 |
| POST   | `/api/uploadthing` | Handles file upload requests for UploadThing (preview flow).                 |

## Workflow: File Previews and Automated Cleanup

The preview-and-cleanup flow works like this:

1. A client initiates a preview upload via the frontend, which calls the
   backend `/api/uploadthing` route.
2. The backend authenticates with UploadThing using `UPLOADTHING_TOKEN`. On
   successful upload, `onUploadComplete` is called.
3. The backend stores minimal metadata in Postgres (`uploaded_files` table),
   including `file_key`, `file_url`, `file_name`, and a timestamp.
4. The cleanup service runs:
    - It finds rows where `uploaded_at` is older than 24 hours.
    - It calls UploadThing to delete those files (by their keys).
    - Only if UploadThing deletion succeeds, it removes the corresponding rows
      from the database.
    - If UploadThing deletion fails, it logs the failure and skips DB deletion
      for those keys to avoid dangling references to files that still exist.
5. This job runs once on startup and then at a fixed interval (60 minutes by
   default in `server.js`). The retention window and schedule can be adjusted
   in code.

Operational notes:

- If the database is not initialised or `DATABASE_URL` is missing, the
  cleanup service will log and skip its run (it will not crash the server).
- The `uploaded_files` table is created automatically on startup if DB is
  enabled. Creation of this table is idempotent. No duplicates will be made
  if the table already exists.
- This cleanup is meant for preview files and short-lived assets. Adjust
  the retention to fit your needs.

## Tech Stack

- Runtime: Node.js
- Server: Built-in `http` module
- WebSockets: `ws` library
- File previews: UploadThing Server SDK
- Database: PostgreSQL (via `pg`)

## Getting Started (Local Development)

To run the signaling server locally, follow these steps.

### Prerequisites

- Node.js (^22 or later)
- npm / pnpm / yarn
- PostgreSQL (optional for signaling only, required to enable preview
  metadata storage and automated cleanup)

### Installation & Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/medy17/DropSilk_Backend.git
   cd DropSilk_Backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root of the project. This is where you'll store
   your secrets and configuration.

   ```
   # .env

   # Required for the PPTX preview feature. Get this from UploadThing.
   UPLOADTHING_TOKEN="YOUR_SECRET_KEY_HERE"

   # A secret key to protect the /logs endpoint.
   LOG_ACCESS_KEY="a-very-secret-and-random-string-for-logs"

   # Optional in local dev; required in production if you want preview
   # persistence and cleanup. Standard Postgres connection string:
   # postgres://USER:PASSWORD@HOST:PORT/DBNAME
   DATABASE_URL="postgres://postgres:postgres@localhost:5432/dropsilk"

   # In production, set this to your public server URL. In dev you can leave
   # it unset; the backend will fall back to http://localhost:8080.
   PUBLIC_SERVER_URL="http://localhost:8080"
   ```

   Notes:
    - If `DATABASE_URL` is not set, DB features (metadata storage) are disabled
      and the cleanup service will skip its work.
    - The server will create the `uploaded_files` table automatically when DB
      is enabled.

### Running the Server

1. Start the server:
   ```bash
   npm start
   ```
   By default, the server will run on `http://localhost:8080`.

2. Running with the frontend:
   When running the
   [DropSilk Frontend](https://github.com/medy17/dropsilk) locally (typically
   on port `5173`), allow the backend to accept that origin:
   ```bash
   npm start -- --allow-local-port=5173
   ```
   The server will now accept WebSocket connections from
   `http://localhost:5173` and `http://127.0.0.1:5173`.

3. Local database tip (optional):
   If you want the full preview+cleanup flow locally, make sure Postgres is
   running and `DATABASE_URL` is set in your `.env`.

### Cleanup Service Configuration

No extra setup is required: the cleanup service starts with the application,
runs once immediately, and then on a fixed schedule.

- Retention window: 24 hours. Defined in
  `src/cleanupService.js` as `TWENTY_FOUR_HOURS_IN_MS`.
- Schedule: Every 60 minutes by default in this repo. This is set in
  `server.js` by calling `startCleanupService(60)`.
- To change the schedule, adjust the argument to `startCleanupService(...)`.
  To change retention, update the constant in `cleanupService.js`.

Advanced notes:

- The cleanup service uses UploadThing's API to delete files. If that API
  call fails, database records are not removed, ensuring consistency with
  what's actually stored remotely.
- If you start the server with `--noDB`, DB initialisation is skipped and the
  cleanup job will no-op (with a log message).

## Deployment

This server is designed to be lightweight and stateless, making it easy to
deploy on platforms like Render, Heroku, or any service that supports Node.js.

The live version is currently deployed on Render.

### Required Environment Variables for Production

Set these in your hosting provider's dashboard:

- `NODE_ENV`: Set to `production`.
- `UPLOADTHING_TOKEN`: Your secret key from the UploadThing service.
- `LOG_ACCESS_KEY`: Your chosen secret key for accessing the logs.
- `PUBLIC_SERVER_URL`: The public URL of your deployed server
  (e.g., `https://your-app-name.onrender.com`). Required for UploadThing's
  callback to function correctly.
- `DATABASE_URL`: PostgreSQL connection string. Required to persist preview
  metadata and enable the automated cleanup service. Without it, the cleanup
  job will skip and preview files will not be removed automatically.

### Origin Security and Previews

- Allowed origins are strictly enforced in production via a static allow-list
  and a regex for Vercel preview URLs.
- For local development, use `--allow-local-port=PORT` to dynamically allow
  `http://localhost:PORT` and `http://127.0.0.1:PORT`.

## Monitoring and Logs

- `/logs?key=...` returns the most recent in-memory log lines. Use your
  `LOG_ACCESS_KEY` to access it.
- The cleanup service logs each run, including:
    - Whether DB is available.
    - How many files were found for deletion.
    - Success/failure of UploadThing deletions.
    - How many DB records were pruned.

## License

This project is licensed under the GPLv3. See the `LICENSE` file for more
information.