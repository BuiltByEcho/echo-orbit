import { access, constants, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const REQUIRED_FILES = [
  "AGENT_ACTIONS.md",
  "SKILL.md",
  "mcp-server.js",
  "orbit.mcp.json",
  "openapi.json",
  "bazaar-resource.json",
  "mcp-readiness.json",
];

const JSON_FILES = [
  "orbit.mcp.json",
  "openapi.json",
  "bazaar-resource.json",
  "mcp-readiness.json",
];

export async function doctorPackage(dir) {
  const checks = [];
  for (const file of REQUIRED_FILES) {
    const path = join(dir, file);
    checks.push(await checkFile(path, file));
  }
  for (const file of JSON_FILES) {
    checks.push(await checkJson(join(dir, file), file));
  }
  checks.push(await checkExecutable(join(dir, "mcp-server.js"), "mcp-server.js executable"));

  const ok = checks.every((check) => check.ok);
  return { ok, checks };
}

export async function testMcpPackage(dir) {
  const doctor = await doctorPackage(dir);
  if (!doctor.ok) return { ok: false, checks: doctor.checks };

  const serverPath = join(dir, "mcp-server.js");
  const child = spawn(process.execPath, [serverPath], {
    cwd: dir,
    env: {
      ...process.env,
      ORBIT_TARGET_BASE_URL: process.env.ORBIT_TARGET_BASE_URL ?? "https://example.com",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = [];
  let stdout = "";
  let stderr = "";
  const done = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ timeout: true }), 3000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        responses.push(JSON.parse(line));
      }
      if (responses.some((response) => response.id === 2)) {
        clearTimeout(timeout);
        resolve({ timeout: false });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ timeout: false, error });
    });
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);

  const result = await done;
  child.kill();

  const initialize = responses.find((response) => response.id === 1);
  const toolsList = responses.find((response) => response.id === 2);
  const checks = [
    ...doctor.checks,
    { key: "mcp_initialize", ok: Boolean(initialize?.result?.serverInfo), reason: initialize?.result?.serverInfo ? "initialize returned server info" : "initialize failed" },
    { key: "mcp_tools_list", ok: Array.isArray(toolsList?.result?.tools), reason: Array.isArray(toolsList?.result?.tools) ? `${toolsList.result.tools.length} tools listed` : "tools/list failed" },
  ];
  if (result.timeout) checks.push({ key: "mcp_timeout", ok: false, reason: "MCP smoke test timed out" });
  if (result.error) checks.push({ key: "mcp_error", ok: false, reason: result.error.message });
  if (stderr.trim()) checks.push({ key: "mcp_stderr", ok: false, reason: stderr.trim() });

  return { ok: checks.every((check) => check.ok), checks };
}

function renderChecks(title, result) {
  const lines = [title];
  for (const check of result.checks) {
    lines.push(`${check.ok ? "ok" : "fail"} ${check.key}: ${check.reason}`);
  }
  lines.push(`status: ${result.ok ? "ok" : "failed"}`);
  return `${lines.join("\n")}\n`;
}

export function renderDoctor(result) {
  return renderChecks("echo-orbit doctor", result);
}

export function renderMcpTest(result) {
  return renderChecks("echo-orbit test", result);
}

async function checkFile(path, key) {
  try {
    const fileStat = await stat(path);
    return { key, ok: fileStat.isFile(), reason: fileStat.isFile() ? "present" : "not a file" };
  } catch {
    return { key, ok: false, reason: "missing" };
  }
}

async function checkJson(path, key) {
  try {
    JSON.parse(await readFile(path, "utf8"));
    return { key: `${key} valid`, ok: true, reason: "valid JSON" };
  } catch (error) {
    return { key: `${key} valid`, ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function checkExecutable(path, key) {
  try {
    await access(path, constants.X_OK);
    return { key, ok: true, reason: "executable" };
  } catch {
    return { key, ok: false, reason: "not executable" };
  }
}
