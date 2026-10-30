import { readFileSync } from "node:fs";

/** Read from package.json so there is a single place to bump. Works from `src/` and `dist/`. */
export const packageVersion: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;
