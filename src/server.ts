import { createGasRouteOracleApp } from "./index.js";

const app = createGasRouteOracleApp();
const port = Number(process.env.PORT ?? 8080);

// Support both Bun and Node.js
if (typeof Bun !== "undefined") {
  // Bun runtime
  const server = Bun.serve({ fetch: app.fetch, port });
  console.log(`GasRoute Oracle (Bun) on http://localhost:${server.port}`);
} else {
  // Node.js runtime — use @hono/node-server
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`GasRoute Oracle (Node) on http://localhost:${info.port}`);
  });
}

console.log(`  Health:      GET  http://localhost:${port}/health`);
console.log(`  Entrypoints: GET  http://localhost:${port}/entrypoints`);
console.log(`  Invoke:      POST http://localhost:${port}/entrypoints/estimate/invoke`);
