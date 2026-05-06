import { cpSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "src", "init", "templates");
const dest = join(root, "dist", "init", "templates");

if (existsSync(dest)) {
  rmSync(dest, { recursive: true });
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
