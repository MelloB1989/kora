// Backend endpoints. Override at build time with a .env file:
//   VITE_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com/prod
//   VITE_WS_URL=wss://xxxx.execute-api.us-east-1.amazonaws.com/prod
// Defaults target the localdev server (backend/cmd/localdev).

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
export const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
