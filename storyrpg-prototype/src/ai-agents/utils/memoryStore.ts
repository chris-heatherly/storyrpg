/**
 * MemoryStore — Client-side implementation of Claude's memory tool protocol.
 *
 * Handles the 6 memory commands (view, create, str_replace, insert, delete, rename)
 * with path-traversal protection rooted at a configurable memory directory.
 *
 * Two implementations:
 *  - NodeMemoryStore: direct fs access (worker / Docker / Node.js)
 *  - ProxyMemoryStore: delegates to proxy-server REST endpoint (web runtime)
 */

import { isWebRuntime } from '../../utils/runtimeEnv';

// ── Types ──────────────────────────────────────────────────────────

export interface MemoryCommand {
  command: 'view' | 'create' | 'str_replace' | 'insert' | 'delete' | 'rename';
  path?: string;
  view_range?: [number, number];
  file_text?: string;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  insert_text?: string;
  old_path?: string;
  new_path?: string;
}

export interface MemoryStore {
  execute(cmd: MemoryCommand): Promise<string>;
}

// ── Path safety ────────────────────────────────────────────────────

function assertSafePath(requested: string, root: string): string {
  const path = require('path');
  const resolved = path.resolve(root, requested.replace(/^\/memories\/?/, ''));
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error(`Path traversal blocked: ${requested}`);
  }
  return resolved;
}

function formatLineNumber(n: number): string {
  return String(n).padStart(6, ' ');
}

// ── NodeMemoryStore ────────────────────────────────────────────────

export class NodeMemoryStore implements MemoryStore {
  private root: string;

  constructor(rootDir: string) {
    this.root = rootDir;
  }

  async execute(cmd: MemoryCommand): Promise<string> {
    switch (cmd.command) {
      case 'view':
        return this.view(cmd.path!, cmd.view_range);
      case 'create':
        return this.create(cmd.path!, cmd.file_text!);
      case 'str_replace':
        return this.strReplace(cmd.path!, cmd.old_str!, cmd.new_str!);
      case 'insert':
        return this.insert(cmd.path!, cmd.insert_line!, cmd.insert_text!);
      case 'delete':
        return this.del(cmd.path!);
      case 'rename':
        return this.rename(cmd.old_path!, cmd.new_path!);
      default:
        return `Error: Unknown command "${(cmd as any).command}"`;
    }
  }

  private async view(memPath: string, viewRange?: [number, number]): Promise<string> {
    const fsSync = require('fs');
    const fs = fsSync.promises as typeof import('fs/promises');
    const path = require('path');
    const resolved = assertSafePath(memPath, this.root);

    let stat: any;
    try {
      stat = await fs.stat(resolved);
    } catch {
      return `The path ${memPath} does not exist. Please provide a valid path.`;
    }

    if (stat.isDirectory()) {
      const entries = await this.listDir(resolved, memPath, 0, 2);
      const dirSize = this.humanSize(stat.size);
      return `Here're the files and directories up to 2 levels deep in ${memPath}, excluding hidden items and node_modules:\n${dirSize}\t${memPath}\n${entries}`;
    }

    const content = await fs.readFile(resolved, 'utf8');
    const lines = content.split('\n');

    if (lines.length > 999_999) {
      return `File ${memPath} exceeds maximum line limit of 999,999 lines.`;
    }

    let start = 1;
    let end = lines.length;
    if (viewRange) {
      start = Math.max(1, viewRange[0]);
      end = Math.min(lines.length, viewRange[1]);
    }

    const numbered = lines
      .slice(start - 1, end)
      .map((line, i) => `${formatLineNumber(start + i)}\t${line}`)
      .join('\n');

    return `Here's the content of ${memPath} with line numbers:\n${numbered}`;
  }

  private async listDir(absDir: string, memDir: string, depth: number, maxDepth: number): Promise<string> {
    if (depth >= maxDepth) return '';
    const fs = require('fs').promises as typeof import('fs/promises');
    const path = require('path');
    let entries: string[];
    try {
      entries = await fs.readdir(absDir);
    } catch {
      return '';
    }
    const lines: string[] = [];
    for (const entry of entries.sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const absPath = path.join(absDir, entry);
      const memPath = memDir.endsWith('/') ? `${memDir}${entry}` : `${memDir}/${entry}`;
      try {
        const stat = await fs.stat(absPath);
        lines.push(`${this.humanSize(stat.size)}\t${memPath}`);
        if (stat.isDirectory()) {
          const sub = await this.listDir(absPath, memPath, depth + 1, maxDepth);
          if (sub) lines.push(sub);
        }
      } catch { /* skip inaccessible */ }
    }
    return lines.join('\n');
  }

  private humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }

  private async create(memPath: string, fileText: string): Promise<string> {
    const fs = require('fs').promises as typeof import('fs/promises');
    const path = require('path');
    const resolved = assertSafePath(memPath, this.root);

    try {
      await fs.access(resolved);
      return `Error: File ${memPath} already exists`;
    } catch { /* file doesn't exist — good */ }

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, fileText, 'utf8');
    return `File created successfully at: ${memPath}`;
  }

  private async strReplace(memPath: string, oldStr: string, newStr: string): Promise<string> {
    const fs = require('fs').promises as typeof import('fs/promises');
    const resolved = assertSafePath(memPath, this.root);

    let content: string;
    try {
      content = await fs.readFile(resolved, 'utf8');
    } catch {
      return `Error: The path ${memPath} does not exist. Please provide a valid path.`;
    }

    const occurrences: number[] = [];
    let searchFrom = 0;
    while (true) {
      const idx = content.indexOf(oldStr, searchFrom);
      if (idx === -1) break;
      const lineNum = content.substring(0, idx).split('\n').length;
      occurrences.push(lineNum);
      searchFrom = idx + 1;
    }

    if (occurrences.length === 0) {
      return `No replacement was performed, old_str \`${oldStr}\` did not appear verbatim in ${memPath}.`;
    }
    if (occurrences.length > 1) {
      return `No replacement was performed. Multiple occurrences of old_str \`${oldStr}\` in lines: ${occurrences.join(', ')}. Please ensure it is unique`;
    }

    const updated = content.replace(oldStr, newStr);
    await fs.writeFile(resolved, updated, 'utf8');

    const lines = updated.split('\n');
    const replaceLine = occurrences[0];
    const snippetStart = Math.max(0, replaceLine - 3);
    const snippetEnd = Math.min(lines.length, replaceLine + 3);
    const snippet = lines
      .slice(snippetStart, snippetEnd)
      .map((line, i) => `${formatLineNumber(snippetStart + i + 1)}\t${line}`)
      .join('\n');

    return `The memory file has been edited.\n${snippet}`;
  }

  private async insert(memPath: string, insertLine: number, insertText: string): Promise<string> {
    const fs = require('fs').promises as typeof import('fs/promises');
    const resolved = assertSafePath(memPath, this.root);

    let content: string;
    try {
      content = await fs.readFile(resolved, 'utf8');
    } catch {
      return `Error: The path ${memPath} does not exist`;
    }

    const lines = content.split('\n');
    if (insertLine < 0 || insertLine > lines.length) {
      return `Error: Invalid \`insert_line\` parameter: ${insertLine}. It should be within the range of lines of the file: [0, ${lines.length}]`;
    }

    const newLines = insertText.split('\n');
    lines.splice(insertLine, 0, ...newLines);
    await fs.writeFile(resolved, lines.join('\n'), 'utf8');
    return `The file ${memPath} has been edited.`;
  }

  private async del(memPath: string): Promise<string> {
    const fs = require('fs').promises as typeof import('fs/promises');
    const resolved = assertSafePath(memPath, this.root);

    try {
      await fs.access(resolved);
    } catch {
      return `Error: The path ${memPath} does not exist`;
    }

    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true });
    } else {
      await fs.unlink(resolved);
    }
    return `Successfully deleted ${memPath}`;
  }

  private async rename(oldPath: string, newPath: string): Promise<string> {
    const fs = require('fs').promises as typeof import('fs/promises');
    const path = require('path');
    const resolvedOld = assertSafePath(oldPath, this.root);
    const resolvedNew = assertSafePath(newPath, this.root);

    try {
      await fs.access(resolvedOld);
    } catch {
      return `Error: The path ${oldPath} does not exist`;
    }

    try {
      await fs.access(resolvedNew);
      return `Error: The destination ${newPath} already exists`;
    } catch { /* doesn't exist — good */ }

    await fs.mkdir(path.dirname(resolvedNew), { recursive: true });
    await fs.rename(resolvedOld, resolvedNew);
    return `Successfully renamed ${oldPath} to ${newPath}`;
  }
}

// ── ProxyMemoryStore ───────────────────────────────────────────────

export class ProxyMemoryStore implements MemoryStore {
  private proxyUrl: string;

  constructor(proxyUrl: string = 'http://localhost:3001') {
    this.proxyUrl = proxyUrl;
  }

  async execute(cmd: MemoryCommand): Promise<string> {
    try {
      const response = await fetch(`${this.proxyUrl}/memories/operation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd),
      });
      if (!response.ok) {
        return `Error: Memory operation failed (HTTP ${response.status})`;
      }
      const data = await response.json();
      return data.result || `Error: No result from memory operation`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: Memory operation failed: ${msg}`;
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────

let _sharedStore: MemoryStore | null = null;

export function getMemoryStore(rootDir?: string): MemoryStore {
  if (_sharedStore) return _sharedStore;

  if (isWebRuntime()) {
    _sharedStore = new ProxyMemoryStore();
  } else {
    const path = require('path');
    const root = rootDir || path.resolve(process.cwd(), 'pipeline-memories');
    _sharedStore = new NodeMemoryStore(root);
  }
  return _sharedStore;
}

export function resetMemoryStore(): void {
  _sharedStore = null;
}
