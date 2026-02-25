import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

type NormalizeTextField = (value: unknown) => string | null;

interface CreateProjectRouteHelpersOptions {
  db: DatabaseSync;
  normalizeTextField: NormalizeTextField;
}

export function createProjectRouteHelpers({ db, normalizeTextField }: CreateProjectRouteHelpersOptions) {
  function normalizeProjectPathInput(raw: unknown): string | null {
    const value = normalizeTextField(raw);
    if (!value) return null;

    let candidate = value;
    if (candidate === "~") {
      candidate = os.homedir();
    } else if (candidate.startsWith("~/")) {
      candidate = path.join(os.homedir(), candidate.slice(2));
    } else if (candidate === "/Projects" || candidate.startsWith("/Projects/")) {
      const suffix = candidate.slice("/Projects".length).replace(/^\/+/, "");
      candidate = suffix ? path.join(os.homedir(), "Projects", suffix) : path.join(os.homedir(), "Projects");
    } else if (candidate === "/projects" || candidate.startsWith("/projects/")) {
      const suffix = candidate.slice("/projects".length).replace(/^\/+/, "");
      candidate = suffix ? path.join(os.homedir(), "projects", suffix) : path.join(os.homedir(), "projects");
    }

    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
    return path.normalize(absolute);
  }

  const PROJECT_PATH_SCOPE_CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

  function normalizePathForScopeCompare(value: string): string {
    const normalized = path.normalize(path.resolve(value));
    return PROJECT_PATH_SCOPE_CASE_INSENSITIVE ? normalized.toLowerCase() : normalized;
  }

  function parseProjectPathAllowedRootsEnv(raw: string | undefined): string[] {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return [];
    const parts = text
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const normalized = normalizeProjectPathInput(part);
      if (!normalized) continue;
      const key = normalizePathForScopeCompare(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }
    return out;
  }

  const PROJECT_PATH_ALLOWED_ROOTS = parseProjectPathAllowedRootsEnv(process.env.PROJECT_PATH_ALLOWED_ROOTS);

  function pathInsideRoot(candidatePath: string, rootPath: string): boolean {
    const rel = path.relative(rootPath, candidatePath);
    if (!rel) return true;
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  function isPathInsideAllowedRoots(candidatePath: string): boolean {
    if (PROJECT_PATH_ALLOWED_ROOTS.length === 0) return true;
    const normalizedCandidate = path.normalize(path.resolve(candidatePath));
    return PROJECT_PATH_ALLOWED_ROOTS.some((root) => pathInsideRoot(normalizedCandidate, root));
  }

  function getContainingAllowedRoot(candidatePath: string): string | null {
    if (PROJECT_PATH_ALLOWED_ROOTS.length === 0) return null;
    const normalizedCandidate = path.normalize(path.resolve(candidatePath));
    const containingRoots = PROJECT_PATH_ALLOWED_ROOTS.filter((root) => pathInsideRoot(normalizedCandidate, root));
    if (containingRoots.length === 0) return null;
    containingRoots.sort((a, b) => b.length - a.length);
    return containingRoots[0];
  }

  function pickDefaultBrowseRoot(): string | null {
    if (PROJECT_PATH_ALLOWED_ROOTS.length > 0) {
      for (const root of PROJECT_PATH_ALLOWED_ROOTS) {
        try {
          if (fs.statSync(root).isDirectory()) return root;
        } catch {
          // continue
        }
      }
      return PROJECT_PATH_ALLOWED_ROOTS[0] ?? null;
    }

    const homeDir = os.homedir();
    for (const candidate of [path.join(homeDir, "Projects"), path.join(homeDir, "projects"), homeDir, process.cwd()]) {
      try {
        if (fs.statSync(candidate).isDirectory()) return candidate;
      } catch {
        // continue
      }
    }
    return process.cwd();
  }

  function findConflictingProjectByPath(
    targetPath: string,
    excludeProjectId?: string,
  ): { id: string; name: string; project_path: string } | undefined {
    if (PROJECT_PATH_SCOPE_CASE_INSENSITIVE) {
      if (excludeProjectId) {
        return db
          .prepare(
            "SELECT id, name, project_path FROM projects WHERE LOWER(project_path) = LOWER(?) AND id != ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1",
          )
          .get(targetPath, excludeProjectId) as { id: string; name: string; project_path: string } | undefined;
      }
      return db
        .prepare(
          "SELECT id, name, project_path FROM projects WHERE LOWER(project_path) = LOWER(?) ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1",
        )
        .get(targetPath) as { id: string; name: string; project_path: string } | undefined;
    }
    if (excludeProjectId) {
      return db
        .prepare(
          "SELECT id, name, project_path FROM projects WHERE project_path = ? AND id != ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1",
        )
        .get(targetPath, excludeProjectId) as { id: string; name: string; project_path: string } | undefined;
    }
    return db
      .prepare(
        "SELECT id, name, project_path FROM projects WHERE project_path = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1",
      )
      .get(targetPath) as { id: string; name: string; project_path: string } | undefined;
  }

  function inspectDirectoryPath(targetPath: string): {
    exists: boolean;
    isDirectory: boolean;
    canCreate: boolean;
    nearestExistingParent: string | null;
  } {
    try {
      const stat = fs.statSync(targetPath);
      const isDirectory = stat.isDirectory();
      return {
        exists: true,
        isDirectory,
        canCreate: isDirectory,
        nearestExistingParent: isDirectory ? targetPath : path.dirname(targetPath),
      };
    } catch {
      // fall through
    }

    let probe = path.dirname(targetPath);
    let nearestExistingParent: string | null = null;
    while (probe && probe !== path.dirname(probe)) {
      try {
        if (fs.statSync(probe).isDirectory()) {
          nearestExistingParent = probe;
          break;
        }
      } catch {
        // keep walking up
      }
      probe = path.dirname(probe);
    }

    if (!nearestExistingParent) {
      nearestExistingParent = path.parse(targetPath).root || null;
    }

    let canCreate = false;
    if (nearestExistingParent) {
      try {
        fs.accessSync(nearestExistingParent, fs.constants.W_OK);
        canCreate = true;
      } catch {
        canCreate = false;
      }
    }

    return {
      exists: false,
      isDirectory: false,
      canCreate,
      nearestExistingParent,
    };
  }

  function ensureDirectoryPathExists(targetPath: string): { ok: true } | { ok: false; reason: string } {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `mkdir_failed:${message}` };
    }
    try {
      if (!fs.statSync(targetPath).isDirectory()) {
        return { ok: false, reason: "not_a_directory" };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `stat_failed:${message}` };
    }
    return { ok: true };
  }

  function collectProjectPathSuggestions(query: string, limit: number): string[] {
    const roots =
      PROJECT_PATH_ALLOWED_ROOTS.length > 0
        ? PROJECT_PATH_ALLOWED_ROOTS
        : [path.join(os.homedir(), "Projects"), path.join(os.homedir(), "projects")];
    const q = query.trim().toLowerCase();
    const out = new Set<string>();
    const seenCanonical = new Set<string>();
    const treatCaseInsensitive = process.platform === "win32" || process.platform === "darwin";
    const canonicalKeyOf = (candidate: string): { key: string; display: string } => {
      let resolved = candidate;
      try {
        resolved = fs.realpathSync(candidate);
      } catch {
        // keep raw path
      }
      const normalized = path.normalize(resolved);
      return {
        key: treatCaseInsensitive ? normalized.toLowerCase() : normalized,
        display: normalized,
      };
    };
    const addIfMatch = (candidate: string) => {
      if (out.size >= limit) return;
      const { key, display: normalized } = canonicalKeyOf(candidate);
      if (seenCanonical.has(key)) return;
      const haystack = `${path.basename(normalized)} ${normalized}`.toLowerCase();
      if (!q || haystack.includes(q)) {
        out.add(normalized);
        seenCanonical.add(key);
      }
    };

    for (const root of roots) {
      try {
        if (!fs.statSync(root).isDirectory()) continue;
      } catch {
        continue;
      }

      addIfMatch(root);
      if (out.size >= limit) break;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (out.size >= limit) break;
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        addIfMatch(path.join(root, entry.name));
      }
    }

    return [...out].slice(0, limit);
  }

  function findNearestExistingDirectory(targetPath: string): string | null {
    let probe = targetPath;
    while (probe && probe !== path.dirname(probe)) {
      try {
        if (fs.statSync(probe).isDirectory()) return probe;
      } catch {
        // keep walking up
      }
      probe = path.dirname(probe);
    }
    try {
      if (probe && fs.statSync(probe).isDirectory()) return probe;
    } catch {
      // ignore
    }
    return null;
  }

  function resolveInitialBrowsePath(pathQuery: string | null): string {
    const preferred = normalizeProjectPathInput(pathQuery);
    if (preferred) {
      if (!isPathInsideAllowedRoots(preferred)) {
        const fallback = pickDefaultBrowseRoot();
        return fallback || process.cwd();
      }
      const nearest = findNearestExistingDirectory(preferred);
      if (nearest) return nearest;
    }
    return pickDefaultBrowseRoot() || process.cwd();
  }

  function execFileText(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    });
  }

  async function pickNativeDirectoryPath(): Promise<{ path: string | null; cancelled: boolean; source: string }> {
    const timeoutMs = 60_000;

    if (process.platform === "darwin") {
      const script =
        'try\nPOSIX path of (choose folder with prompt "Select project folder for Claw-Empire")\non error number -128\n""\nend try';
      const { stdout } = await execFileText("osascript", ["-e", script], timeoutMs);
      const value = stdout.trim();
      return { path: value || null, cancelled: !value, source: "osascript" };
    }

    if (process.platform === "win32") {
      const psScript = [
        "Add-Type -AssemblyName System.Windows.Forms | Out-Null;",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
        "$dialog.Description = 'Select project folder for Claw-Empire';",
        "$dialog.UseDescriptionForTitle = $true;",
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }",
      ].join(" ");
      const { stdout } = await execFileText(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
        timeoutMs,
      );
      const value = stdout.trim();
      return { path: value || null, cancelled: !value, source: "powershell" };
    }

    try {
      const { stdout } = await execFileText(
        "zenity",
        ["--file-selection", "--directory", "--title=Select project folder for Claw-Empire"],
        timeoutMs,
      );
      const value = stdout.trim();
      return { path: value || null, cancelled: !value, source: "zenity" };
    } catch {
      try {
        const { stdout } = await execFileText(
          "kdialog",
          [
            "--getexistingdirectory",
            path.join(os.homedir(), "Projects"),
            "--title",
            "Select project folder for Claw-Empire",
          ],
          timeoutMs,
        );
        const value = stdout.trim();
        return { path: value || null, cancelled: !value, source: "kdialog" };
      } catch {
        return { path: null, cancelled: false, source: "unsupported" };
      }
    }
  }

  function validateProjectAgentIds(
    raw: unknown,
  ): { agentIds: string[] } | { error: { code: string; invalidIds?: string[] } } {
    if (raw === undefined) return { agentIds: [] };
    if (!Array.isArray(raw)) {
      return { error: { code: "invalid_agent_ids_type" } };
    }
    const agentIds = [
      ...new Set(raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0)),
    ];
    if (agentIds.length === 0) return { agentIds };

    const placeholders = agentIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT id FROM agents WHERE id IN (${placeholders})`).all(...agentIds) as Array<{
      id: string;
    }>;
    const existing = new Set(rows.map((row) => row.id));
    const invalidIds = agentIds.filter((id) => !existing.has(id));
    if (invalidIds.length > 0) {
      return { error: { code: "invalid_agent_ids", invalidIds } };
    }
    return { agentIds };
  }

  return {
    PROJECT_PATH_ALLOWED_ROOTS,
    normalizeProjectPathInput,
    pathInsideRoot,
    isPathInsideAllowedRoots,
    getContainingAllowedRoot,
    findConflictingProjectByPath,
    inspectDirectoryPath,
    ensureDirectoryPathExists,
    collectProjectPathSuggestions,
    resolveInitialBrowsePath,
    pickNativeDirectoryPath,
    validateProjectAgentIds,
  };
}
