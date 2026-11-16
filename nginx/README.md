# Nginx Reverse Proxy

Nginx acts as the single entry point for the entire application, handling all routing between the user's browser and the internal Docker services.

## Routing Rules
- **`/api/`**: Proxied to the `backend` container on port `8080`.
- **`/images/`**: Proxied to the `backend` container on port `8080` (for serving processed receipt images).
- **`/` (Everything else)**: Proxied to the `frontend` container on port `5173`.

## WebSocket Support
The configuration explicitly includes the `Upgrade` headers required by Vite to maintain the Hot Module Replacement (HMR) websocket connection during development.
