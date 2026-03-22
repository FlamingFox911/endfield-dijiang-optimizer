import { rm } from "node:fs/promises";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  throw new Error("clean-dist.ts requires a target directory.");
}

await rm(path.resolve(process.cwd(), target), {
  recursive: true,
  force: true,
});
