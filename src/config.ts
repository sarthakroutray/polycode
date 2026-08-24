import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { polycodeConfigSchema } from './types.js';
import type { PolycodeConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The default config, mirrored verbatim from docs/polycode.config.example.json. */
export function generateDefaultConfig(): PolycodeConfig {
  const here = path.resolve(__dirname, '..');
  const examplePath = path.join(here, 'docs', 'polycode.config.example.json');
  const raw = readFileSync(examplePath, 'utf8');
  const parsed = polycodeConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `docs/polycode.config.example.json is not a valid default config: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * Resolve the config file path. Order: explicit → ./polycode.config.json →
 * ~/.config/polycode/config.json. Returns the first that exists, else null.
 */
export function resolveConfigPath(explicit?: string): string | null {
  const candidates: string[] = [];
  if (explicit) {
    candidates.push(path.resolve(explicit));
  } else {
    candidates.push(path.resolve('polycode.config.json'));
    const home = os.homedir();
    if (home) {
      candidates.push(path.join(home, '.config', 'polycode', 'config.json'));
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export type LoadResult =
  | { config: PolycodeConfig; path: string; error?: never }
  | { error: string; config?: never; path?: never };

/**
 * Load and validate a config. Never throws for config problems — returns a
 * human-readable error listing every issue.path → issue.message.
 */
export function loadpolycodeConfig(explicit?: string): LoadResult {
  const found = resolveConfigPath(explicit);
  if (!found) {
    return {
      error: explicit
        ? `Config not found: ${explicit}`
        : 'No polycode.config.json found (checked ./polycode.config.json and ~/.config/polycode/config.json). Run `polycode init` to create one.',
    };
  }

  let raw: string;
  try {
    raw = readFileSync(found, 'utf8');
  } catch (err) {
    return { error: `Failed to read config at ${found}: ${String(err)}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { error: `Config at ${found} is not valid JSON: ${String(err)}` };
  }

  const parsed = polycodeConfigSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'} → ${issue.message}`)
      .join('\n');
    return { error: `Invalid config at ${found}:\n${details}` };
  }

  return { config: parsed.data, path: found };
}

/** Write a default config file. Refuses to overwrite unless force is set. */
export function initConfig(targetPath?: string, force = false): string {
  const target = path.resolve(targetPath ?? 'polycode.config.json');
  if (existsSync(target) && !force) {
    throw new Error(
      `Refusing to overwrite existing config at ${target}. Use --force to replace it.`,
    );
  }
  const json = generateDefaultConfig();
  const body = JSON.stringify(json, null, 2) + '\n';
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body, 'utf8');
  return target;
}

/** Read package.json version for --version. */
export function readPackageVersion(): string {
  const pkgUrl = pathToFileURL(path.join(__dirname, '..', 'package.json')).href;
  const pkg = JSON.parse(readFileSync(new URL(pkgUrl), 'utf8'));
  return String(pkg.version ?? '0.0.0');
}