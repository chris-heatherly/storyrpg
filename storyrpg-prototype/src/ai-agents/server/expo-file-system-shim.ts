import * as fs from 'fs/promises';
import * as path from 'path';

const toFsPath = (p: string): string => {
  if (!p) return p;
  return p.replace(/^file:\/\//, '');
};

export const documentDirectory = path.resolve(process.cwd()) + '/';

export const EncodingType = {
  UTF8: 'utf8',
  Base64: 'base64',
};

export async function getInfoAsync(targetPath: string): Promise<{ exists: boolean; size?: number }> {
  try {
    const stat = await fs.stat(toFsPath(targetPath));
    return { exists: true, size: stat.size };
  } catch {
    return { exists: false };
  }
}

export async function makeDirectoryAsync(targetPath: string, options?: { intermediates?: boolean }): Promise<void> {
  await fs.mkdir(toFsPath(targetPath), { recursive: !!options?.intermediates });
}

export async function writeAsStringAsync(
  targetPath: string,
  content: string,
  options?: { encoding?: string }
): Promise<void> {
  const filePath = toFsPath(targetPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const encoding = options?.encoding === EncodingType.Base64 ? 'base64' : 'utf8';
  await fs.writeFile(filePath, content, { encoding });
}

export async function readAsStringAsync(
  targetPath: string,
  options?: { encoding?: string }
): Promise<string> {
  const encoding = options?.encoding === EncodingType.Base64 ? 'base64' : 'utf8';
  return fs.readFile(toFsPath(targetPath), { encoding: encoding as BufferEncoding });
}

export async function readDirectoryAsync(targetPath: string): Promise<string[]> {
  return fs.readdir(toFsPath(targetPath));
}

export async function deleteAsync(targetPath: string, options?: { idempotent?: boolean }): Promise<void> {
  try {
    await fs.rm(toFsPath(targetPath), { recursive: true, force: !!options?.idempotent });
  } catch (e) {
    if (!options?.idempotent) throw e;
  }
}

export async function moveAsync(input: { from: string; to: string }): Promise<void> {
  const from = toFsPath(input.from);
  const to = toFsPath(input.to);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

