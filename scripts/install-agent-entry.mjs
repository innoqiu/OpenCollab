import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "true"];
  })
);

const targetRoot = path.resolve(args.target ?? process.cwd());
const force = args.force === "true";
const includeSampleStatus = args["with-sample-status"] === "true";

const files = [
  ["AGENTS.md", "AGENTS.md"],
  ["CLAUDE.md", "CLAUDE.md"],
  [".claude/commands/ocb.md", ".claude/commands/ocb.md"],
  ["opencollab/AGENT.md", "opencollab/AGENT.md"],
  ["opencollab/PROTOCOL_COMMANDS.md", "opencollab/PROTOCOL_COMMANDS.md"],
  ["opencollab/Task_Status.schema.json", "opencollab/Task_Status.schema.json"],
  ["opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md", "opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md"],
  ["opencollab/PROMPTS.md", "opencollab/PROMPTS.md"],
  ["opencollab/interfaces/README.md", "opencollab/interfaces/README.md"]
];

if (includeSampleStatus) {
  files.push(["opencollab/TTask_Status.json", "opencollab/TTask_Status.json"]);
  files.push(["opencollab/Task_Status.json", "opencollab/Task_Status.json"]);
}

const installed = [];
const skipped = [];

for (const [sourceRelative, targetRelative] of files) {
  const source = path.join(repoRoot, sourceRelative);
  const target = path.join(targetRoot, targetRelative);
  await fs.mkdir(path.dirname(target), { recursive: true });

  if (!force && (await exists(target))) {
    skipped.push(targetRelative);
    continue;
  }

  await fs.copyFile(source, target);
  installed.push(targetRelative);
}

console.log(`OpenCollab agent entry installed in ${targetRoot}`);
if (installed.length) console.log(`Installed: ${installed.join(", ")}`);
if (skipped.length) console.log(`Skipped existing files: ${skipped.join(", ")}`);

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
