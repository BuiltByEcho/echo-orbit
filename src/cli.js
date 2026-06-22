import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { analyzeProject } from "./analyze.js";
import { buildArtifacts } from "./generate.js";
import { polishAnalysis } from "./polish.js";
import { scanProject } from "./scan.js";
import { doctorPackage, renderDoctor, renderMcpTest, testMcpPackage } from "./verify.js";
import packageJson from "../package.json" with { type: "json" };

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.command === "doctor") {
    const result = await doctorPackage(options.dir);
    process.stdout.write(renderDoctor(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (options.command === "test") {
    const result = await testMcpPackage(options.dir);
    process.stdout.write(renderMcpTest(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const scan = await scanProject(options.dir);
  const baseAnalysis = analyzeProject(scan);
  const { analysis, warnings } = await polishAnalysis(scan, baseAnalysis, options);
  const artifacts = buildArtifacts(scan, analysis);

  if (options.write) {
    await mkdir(options.outDir, { recursive: true });
    for (const [filename, contents] of Object.entries(artifacts)) {
      const outputPath = join(options.outDir, filename);
      await writeFile(outputPath, contents, "utf8");
      if (filename.endsWith(".js") && contents.startsWith("#!")) {
        await chmod(outputPath, 0o755);
      }
    }
  }

  process.stdout.write(renderSummary(scan, analysis, artifacts, options, warnings));
}

function parseArgs(argv) {
  let command = "scan";
  let dir = process.cwd();
  let outDir = null;
  let write = true;
  let aiMode = "off";

  const args = [...argv];
  if (["scan", "doctor", "test"].includes(args[0])) {
    command = args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dir") {
      dir = resolve(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--out") {
      outDir = resolve(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--ai") {
      aiMode = args[i + 1] ?? "off";
      if (!["off", "local", "byo"].includes(aiMode)) {
        throw new Error("--ai must be one of: off, local, byo");
      }
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      write = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(helpText());
      process.exit(0);
    }
    if (arg === "--version" || arg === "-v") {
      process.stdout.write(`${packageJson.version}\n`);
      process.exit(0);
    }
  }

  return {
    command,
    dir,
    outDir: outDir ?? dir,
    write,
    aiMode,
  };
}

function renderSummary(scan, analysis, artifacts, options, warnings) {
  const lines = [
    `echo-orbit scanned ${scan.projectName}`,
    `score: ${analysis.scorecard.score}/100 (${analysis.scorecard.status})`,
    `actions: ${analysis.actions.length}`,
    `risks: ${analysis.risks.length}`,
    `ai: ${options.aiMode}`,
  ];

  if (options.write) {
    lines.push(`wrote: ${Object.keys(artifacts).join(", ")}`);
    lines.push(`output_dir: ${options.outDir}`);
  } else {
    lines.push("dry_run: true");
  }

  if (analysis.risks.length) {
    lines.push("top_risks:");
    for (const risk of analysis.risks.slice(0, 3)) {
      lines.push(`- ${risk}`);
    }
  }
  if (warnings.length) {
    lines.push("warnings:");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function helpText() {
  return [
    "Usage: echo-orbit [scan] [--dir <project>] [--out <dir>] [--ai off|local|byo] [--dry-run]",
    "       echo-orbit doctor --dir <generated-package>",
    "       echo-orbit test --dir <generated-package>",
    "       echo-orbit --version",
    "",
    "Scans an app and generates agent-readiness packaging:",
    "- AGENT_ACTIONS.md",
    "- SKILL.md",
    "- mcp-server.js",
    "- orbit.mcp.json",
    "- openapi.json",
    "- bazaar-resource.json",
    "- mcp-readiness.json",
    "",
  ].join("\n");
}
