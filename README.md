
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

This repository contains the backend service for DropSilk. Its primary role is to act as a **WebRTC signaling server**, also known as a "rendezvous" or "matchmaking" service. It uses WebSockets to help two DropSilk clients find each other and exchange the necessary metadata to establish a direct, peer-to-peer connection.

**Crucially, this server does not handle any file transfers.** All files and screen-sharing data are sent directly between the connected peers, ensuring privacy and speed.

Additionally, this server provides a small set of HTTP endpoints for health checks, statistics, and a secure proxy for the UploadThing API, which facilitates file previews for formats like `.pptx`.

### Core Features

-   **WebSocket-based Real-time Signaling:** Manages client connections, disconnections, and the exchange of WebRTC session descriptions (SDP) and ICE candidates.
-   **Flight Management:** Handles the creation of unique, temporary "flight codes" and allows peers to join these flights.
-   **Peer Discovery & LAN/WAN Detection:** Intelligently groups users on the same network (by public IP or private subnet) and informs the clients if a faster LAN connection is possible.
-   **HTTP API Endpoints:**
    -   `GET /`: Health check.
    -   `GET /stats`: Real-time server statistics.
    -   `GET /logs`: A secure, key-protected endpoint to view recent in-memory server logs for debugging.
-   **Secure Upload Endpoint:** Provides a route (`/api/uploadthing`) that securely handles authentication and requests for the `UploadThing` service, used for generating file previews on the frontend.
-   **Robust Security & CORS:** Implements strict origin validation to ensure only trusted frontend clients can connect. Includes support for Vercel preview deployments.
-   **Graceful Shutdown:** Ensures clean termination of connections and processes when the server is stopped or restarted.
-   **In-Memory Logging:** Keeps a running buffer of the most recent log events, accessible via the `/logs` endpoint for easy debugging without writing to disk.

## API & Signaling Protocol

The server communicates with clients primarily over WebSockets using a simple JSON-based protocol.

### WebSocket Messages (Client ↔ Server)

| Type | Direction | Description |
| :--- | :--- | :--- |
| `registered` | S → C | Sent by the server to a new client, providing their unique session ID. |
| `register-details` | C → S | Client sends its generated name to the server. |
| `users-on-network-update` | S → C | Server sends a list of other available users on the same network. |
| `create-flight` | C → S | Client requests the server to create a new private session ("flight"). |
| `flight-created` | S → C | Server responds with the unique 6-character flight code. |
| `join-flight` | C → S | Client requests to join an existing flight using a code. |
| `peer-joined` | S → C | Server notifies both peers that a connection has been established, providing peer info and the connection type (`lan` or `wan`). |
| `peer-left` | S → C | Server notifies a client that their peer has disconnected. |
| `invite-to-flight` | C → S | A client in a flight invites another user on the network to join. |
| `flight-invitation` | S → C | Server forwards the invitation to the target user. |
| `signal` | C ↔ S ↔ C | A client sends WebRTC signaling data (SDP/ICE) to be forwarded to its peer. |
| `error` | S → C | Server sends an error message (e.g., "Flight not found"). |

### HTTP Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Basic health check endpoint. Returns a simple text response. |
| `GET` | `/stats` | Returns a JSON object with server statistics (uptime, memory, connections). |
| `GET` | `/logs?key=[ACCESS_KEY]` | Returns a plain text dump of the recent in-memory logs. Requires a valid `LOG_ACCESS_KEY`. |
| `POST` | `/api/uploadthing` | Handles file upload requests for the UploadThing service. |

## Tech Stack

-   **Runtime:** Node.js
-   **Server:** Built-in `http` module
-   **WebSockets:** `ws` library
-   **File Previews:** `uploadthing` Server SDK

## Getting Started (Local Development)

To run the signaling server locally, follow these steps.

### Prerequisites

-   Node.js (^22 or later)
-   npm / pnpm / yarn

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/medy17/DropSilk_Backend.git
    cd DropSilk_Backend
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root of the project. This is where you'll store your secret keys.
    ```
    # .env

    # Required for the PPTX preview feature. Get this from your UploadThing dashboard.
    UPLOADTHING_TOKEN="YOUR_SECRET_KEY_HERE"

    # A secret key to protect the /logs endpoint. Choose any long, random string.
    LOG_ACCESS_KEY="a-very-secret-and-random-string-for-logs"
    ```

### Running the Server

1.  **Start the server:**
    ```bash
    npm start
    ```
    By default, the server will run on `http://localhost:8080`.

2.  **Running with the Frontend:**
    When running the [DropSilk Frontend](https://github.com/medy17/dropsilk) locally (which typically runs on port `5173`), you need to tell the backend to allow connections from that origin. Use the `--allow-local-port` flag:
    ```bash
    npm start -- --allow-local-port=5173
    ```
    The server will now accept WebSocket connections from `http://localhost:5173`.

## Deployment

This server is designed to be lightweight and stateless, making it easy to deploy on platforms like Render, Heroku, or any service that supports Node.js.

The live version is currently deployed on **Render**.

### Required Environment Variables for Production

When deploying, you must set the following environment variables in your hosting provider's dashboard:

-   `NODE_ENV`: Set to `production`.
-   `UPLOADTHING_TOKEN`: Your secret key from the UploadThing service.
-   `LOG_ACCESS_KEY`: Your chosen secret key for accessing the logs.
-   `PUBLIC_SERVER_URL`: The public URL of your deployed server (e.g., `https://your-app-name.onrender.com`). This is required for UploadThing's callback to function correctly.

## License

This project is licensed under the **GPLv3**. See the `LICENSE` file for more information.
