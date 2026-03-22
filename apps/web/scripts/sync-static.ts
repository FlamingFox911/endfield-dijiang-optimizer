import path from "node:path";

import { resolveRepoPath, syncCatalogsToDirectory } from "@endfield/data/node";

const target = resolveRepoPath("apps", "web", "public");
await syncCatalogsToDirectory(target);
console.log(`synced catalogs -> ${path.relative(resolveRepoPath(), target)}`);
