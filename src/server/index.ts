/** @fileoverview Server barrel — public API for the server module. */

export { broadcastSSE } from './sse.ts';
export { createWebServer } from './lifecycle.ts';
export type { WebServerHandle, WebServerDeps } from './http.ts';
export type { RouteOptions } from './routes.ts';
