import type { CharacterBible } from '../../agents/CharacterDesigner';

export interface CharacterResolutionResult {
  canonicalIds: string[];
  unresolvedIds: string[];
  aliases: Array<{ input: string; canonicalId: string; reason: string }>;
  warnings: string[];
}

export interface CharacterDetection {
  canonicalIds: string[];
  aliases: Array<{ input: string; canonicalId: string; reason: string }>;
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function key(value: string): string {
  return value
    .toLowerCase()
    .replace(/{{\s*player\.[^}]+\s*}}/g, 'player')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactKey(value: string): string {
  return key(value).replace(/\s+/g, '');
}

function canUseCompactTextAlias(aliasKey: string): boolean {
  return aliasKey.includes(' ') && aliasKey.replace(/\s+/g, '').length >= 8;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqAliases(values: CharacterResolutionResult['aliases']): CharacterResolutionResult['aliases'] {
  const seen = new Set<string>();
  return values.filter((alias) => {
    const key = `${alias.input}::${alias.canonicalId}::${alias.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pushNameParts(aliases: string[], value: string): void {
  const name = normalize(value);
  if (!name) return;
  aliases.push(name);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts[0]) aliases.push(parts[0]);
}

function characterAliases(character: any): string[] {
  const aliases = [
    character.id,
    character.name,
    character.displayName,
    character.fullName,
    character.shortName,
    ...(Array.isArray(character.aliases) ? character.aliases : []),
    ...(Array.isArray(character.nicknames) ? character.nicknames : []),
  ].map(normalize).filter(Boolean);

  const idParts = normalize(character.id).split(/[-_\s]+/).filter(Boolean);
  if (idParts[0] === 'char' && idParts[1]) {
    aliases.push(`char-${idParts[1]}`);
    aliases.push(idParts[1]);
  }

  for (const source of [
    character.name,
    character.displayName,
    character.fullName,
    character.shortName,
    ...(Array.isArray(character.aliases) ? character.aliases : []),
    ...(Array.isArray(character.nicknames) ? character.nicknames : []),
  ]) {
    const value = normalize(source);
    if (!value) continue;
    pushNameParts(aliases, value);
    for (const part of value.split(/\s*(?:\/|&|\+|\band\b|\bor\b)\s*/i)) {
      pushNameParts(aliases, part);
    }
    const slashParts = value.split('/').map(normalize).filter(Boolean);
    if (slashParts.length > 1) {
      const tail = slashParts[slashParts.length - 1].split(/\s+/).slice(1).join(' ');
      for (const first of slashParts.slice(0, -1)) {
        if (tail) pushNameParts(aliases, `${first} ${tail}`);
      }
    }
  }

  return uniq(aliases);
}

export class CharacterIdResolver {
  private readonly byExact = new Map<string, string>();
  private readonly byCompact = new Map<string, string>();
  private readonly ambiguousExact = new Set<string>();
  private readonly ambiguousCompact = new Set<string>();
  private readonly characterById = new Map<string, any>();
  readonly protagonistCanonicalId?: string;

  constructor(
    private readonly characterBible: CharacterBible,
    protagonist?: { id?: string; name?: string },
  ) {
    for (const character of characterBible.characters || []) {
      this.characterById.set(character.id, character);
      for (const alias of characterAliases(character)) {
        this.addAlias(alias, character.id);
      }
    }

    const protagonistFromId = protagonist?.id ? this.resolveOne(protagonist.id)?.canonicalId : undefined;
    const protagonistFromName = protagonist?.name ? this.resolveOne(protagonist.name)?.canonicalId : undefined;
    const protagonistFromBible = (characterBible.characters || []).find((character: any) => /protagonist|player|main/i.test(normalize(character.role)))?.id;
    this.protagonistCanonicalId = protagonistFromId || protagonistFromName || protagonistFromBible;

    if (this.protagonistCanonicalId) {
      for (const alias of ['p1', 'player', 'protagonist', 'main character', '{{player.name}}', '{{player.their}}', '{{player.his}}', '{{player.her}}']) {
        this.addAlias(alias, this.protagonistCanonicalId);
      }
      if (protagonist?.id) this.addAlias(protagonist.id, this.protagonistCanonicalId);
      if (protagonist?.name) this.addAlias(protagonist.name, this.protagonistCanonicalId);
    }
  }

  hasCharacter(id: string): boolean {
    return this.characterById.has(id);
  }

  getCharacter(id: string): any | undefined {
    return this.characterById.get(id);
  }

  resolveOne(input: unknown): { canonicalId: string; reason: string } | undefined {
    const raw = normalize(input);
    if (!raw) return undefined;
    if (this.characterById.has(raw)) return { canonicalId: raw, reason: 'canonical-id' };
    const exact = this.byExact.get(key(raw));
    if (exact) return { canonicalId: exact, reason: 'alias' };
    const compact = this.byCompact.get(compactKey(raw));
    if (compact) return { canonicalId: compact, reason: 'compact-alias' };
    return undefined;
  }

  resolveInputs(inputs: unknown[]): CharacterResolutionResult {
    const canonicalIds: string[] = [];
    const unresolvedIds: string[] = [];
    const aliases: CharacterResolutionResult['aliases'] = [];

    for (const input of inputs) {
      const raw = normalize(input);
      if (!raw) continue;
      const resolved = this.resolveOne(raw);
      if (resolved) {
        canonicalIds.push(resolved.canonicalId);
        if (raw !== resolved.canonicalId) aliases.push({ input: raw, canonicalId: resolved.canonicalId, reason: resolved.reason });
      } else {
        unresolvedIds.push(raw);
      }
    }

    return {
      canonicalIds: uniq(canonicalIds),
      unresolvedIds: uniq(unresolvedIds),
      aliases,
      warnings: unresolvedIds.length ? [`Unresolved character ids/aliases: ${uniq(unresolvedIds).join(', ')}`] : [],
    };
  }

  detectFromTextWithAliases(text: string): CharacterDetection {
    const found: string[] = [];
    const aliases: CharacterDetection['aliases'] = [];
    const haystack = ` ${key(text)} `;
    const compactHaystack = compactKey(text);
    for (const character of this.characterBible.characters || []) {
      for (const alias of characterAliases(character)) {
        const aliasKey = key(alias);
        if (!aliasKey) continue;
        const resolved = this.resolveOne(alias);
        if (!resolved || resolved.canonicalId !== character.id) continue;
        if (haystack.includes(` ${aliasKey} `) || (canUseCompactTextAlias(aliasKey) && compactHaystack.includes(compactKey(alias)))) {
          found.push(character.id);
          aliases.push({ input: alias, canonicalId: character.id, reason: 'text-alias' });
          break;
        }
      }
    }
    if (this.protagonistCanonicalId && /{{\s*player\.[^}]+\s*}}|\b(you|your|yourself)\b/i.test(text)) {
      found.push(this.protagonistCanonicalId);
      aliases.push({ input: '{{player.*}}', canonicalId: this.protagonistCanonicalId, reason: 'player-template' });
    }
    return {
      canonicalIds: uniq(found),
      aliases: uniqAliases(aliases),
    };
  }

  detectFromText(text: string): string[] {
    return this.detectFromTextWithAliases(text).canonicalIds;
  }

  private addAlias(alias: string, canonicalId: string): void {
    const normalized = key(alias);
    if (!normalized) return;
    this.addExactAlias(normalized, canonicalId);
    const compact = compactKey(alias);
    if (compact) this.addCompactAlias(compact, canonicalId);
  }

  private addExactAlias(normalized: string, canonicalId: string): void {
    if (this.ambiguousExact.has(normalized)) return;
    const existing = this.byExact.get(normalized);
    if (!existing) {
      this.byExact.set(normalized, canonicalId);
      return;
    }
    if (existing !== canonicalId) {
      this.byExact.delete(normalized);
      this.ambiguousExact.add(normalized);
    }
  }

  private addCompactAlias(compact: string, canonicalId: string): void {
    if (this.ambiguousCompact.has(compact)) return;
    const existing = this.byCompact.get(compact);
    if (!existing) {
      this.byCompact.set(compact, canonicalId);
      return;
    }
    if (existing !== canonicalId) {
      this.byCompact.delete(compact);
      this.ambiguousCompact.add(compact);
    }
  }
}
