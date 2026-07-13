// REST API base URL. Override at build time with VITE_API_URL; defaults to the
// localdev server (backend/cmd/localdev).
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
