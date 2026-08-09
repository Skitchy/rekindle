import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json") as { version?: unknown };

if (typeof packageMetadata.version !== "string" || packageMetadata.version.length === 0) {
  throw new Error("Rekindle package metadata is missing a valid version");
}

/** Runtime version reported to MCP clients, sourced from the shipped package metadata. */
export const REKINDLE_VERSION = packageMetadata.version;
