import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".html",
]);

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "out",
]);

export async function scanProject(inputDir) {
  const dir = resolve(inputDir);
  const packageJson = await readJsonIfExists(join(dir, "package.json"));
  const readme = await readTextIfExists(join(dir, "README.md"));
  const files = await walk(dir);
  const codeFiles = files.filter((file) => TEXT_EXTENSIONS.has(extname(file)));
  const samples = await loadSamples(dir, codeFiles);

  const routes = inferRoutes(dir, samples);
  const projectName = packageJson?.name ?? basename(dir);
  const hasCli = Boolean(packageJson?.bin);
  const hasMcpHints = /mcp/i.test(readme ?? "") || samples.some((sample) => /mcp/i.test(sample.text));
  const hasPaymentHints = samples.some((sample) => /(x402|payment|required|paid|quote|usdc|base mcp)/i.test(sample.text));
  const hasWalletHints = samples.some((sample) => /(wallet|sign|swap|borrow|supply|portfolio|defi)/i.test(sample.text));
  const hasSkillFile = files.some((file) => /(^|\/)SKILL\.md$/i.test(relative(dir, file)));
  const hasAgentActionsFile = files.some((file) => relative(dir, file) === "AGENT_ACTIONS.md");

  return {
    dir,
    projectName,
    packageJson,
    readme,
    files,
    samples,
    routes,
    summary: {
      hasCli,
      hasMcpHints,
      hasPaymentHints,
      hasWalletHints,
      hasReadme: Boolean(readme),
      hasSkillFile,
      hasAgentActionsFile,
    },
  };
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...await walk(full));
      continue;
    }
    output.push(full);
  }
  return output;
}

async function loadSamples(rootDir, files) {
  const picked = [];
  for (const file of files) {
    const rel = relative(rootDir, file);
    if (!shouldSample(rel)) continue;
    const text = await readTextIfExists(file);
    if (!text) continue;
    picked.push({ path: rel, text: text.slice(0, 8000) });
  }
  return picked;
}

function shouldSample(relPath) {
  return (
    /(^|\/)(src|api|app|server|routes|docs|skills)\//i.test(relPath) ||
    /^README\.md$/i.test(relPath) ||
    /package\.json$/i.test(relPath)
  );
}

function inferRoutes(rootDir, samples) {
  const routeMap = new Map();
  for (const sample of samples) {
    const fileRoute = inferFileRoute(sample.path);
    let regexRoute = null;
    const lines = sample.text.split("\n");
    for (const line of lines) {
      const match = line.match(/(?:app|router)\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/i);
      if (match) {
        rememberRoute(routeMap, match[2], match[1].toUpperCase(), sample.path);
      }
      const methodPathMatch = line.match(/(?:req|request)\.method\s*===\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`].*(?:pathname|url\.pathname)\s*===\s*["'`]([^"'`]+)["'`]/);
      if (methodPathMatch) {
        rememberRoute(routeMap, methodPathMatch[2], methodPathMatch[1], sample.path);
      }
      const regexMatch = line.match(/const\s+\w+\s*=\s*\/\^\\\/([^/]+)\\\/([^/]+)\\\/\(\[\^\/\]\+\)/);
      if (regexMatch) {
        regexRoute = `/${regexMatch[1]}/${regexMatch[2]}/:id`;
      }
      const regexMethodMatch = line.match(/if\s*\(\s*\w+\s*&&\s*(?:req|request)\.method\s*===\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`]/);
      if (regexRoute && regexMethodMatch) {
        const suffix = /endsWith\(["'`]\/claim["'`]\)/.test(line) && !/!\s*pathname\.endsWith/.test(line) ? "/claim" : "";
        rememberRoute(routeMap, `${regexRoute}${suffix}`, regexMethodMatch[1], sample.path);
      }
      const nextMatch = line.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/);
      if (nextMatch && fileRoute) {
        rememberRoute(routeMap, fileRoute, nextMatch[1].toUpperCase(), sample.path);
      }
      const nextConstMatch = line.match(/export\s+const\s+(GET|POST|PUT|DELETE|PATCH)\s*=/);
      if (nextConstMatch && fileRoute) {
        rememberRoute(routeMap, fileRoute, nextConstMatch[1].toUpperCase(), sample.path);
      }
      const fetchMatch = line.match(/fetch\(\s*["'`](\/[^"'`]+)["'`]/i);
      if (fetchMatch) {
        rememberRoute(routeMap, fetchMatch[1], "CALL", sample.path);
      }
    }
  }
  return Array.from(routeMap.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function inferFileRoute(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const appApiMatch = normalized.match(/(?:^|\/)app\/api\/(.+)\/route\.[cm]?[jt]sx?$/);
  if (appApiMatch) {
    const route = appApiMatch[1]
      .replace(/\/index$/, "")
      .replace(/\[([^\]]+)\]/g, ":$1");
    return `/${route}`;
  }
  const apiMatch = normalized.match(/(?:^|\/)(api\/.+)\.[cm]?[jt]sx?$/);
  if (!apiMatch) return null;
  const route = apiMatch[1]
    .replace(/\/index$/, "")
    .replace(/\[([^\]]+)\]/g, ":$1");
  return `/${route}`;
}

function rememberRoute(routeMap, path, method, source) {
  const key = `${method}:${path}`;
  if (routeMap.has(key)) return;
  routeMap.set(key, {
    method,
    path,
    source,
  });
}

async function readJsonIfExists(path) {
  const text = await readTextIfExists(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readTextIfExists(path) {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
