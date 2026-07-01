import type { Config } from "@netlify/functions";
import { createGasRouteOracleApp } from "../../src/index.js";

const app = createGasRouteOracleApp();

export default app.fetch;

export const config: Config = {
  path: "/*",
};
