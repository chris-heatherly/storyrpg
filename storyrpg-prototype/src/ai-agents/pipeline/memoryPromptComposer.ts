import type { PipelineMemoryPacket } from './pipelineMemory';

export interface MemoryPromptBudget {
  hardCanonChars: number;
  obligationsChars: number;
  repairChars: number;
  advisoryChars: number;
}

const DEFAULT_BUDGET: MemoryPromptBudget = {
  hardCanonChars: 1200,
  obligationsChars: 1800,
  repairChars: 1800,
  advisoryChars: 1200,
};

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... [memory truncated]` : text;
}

function isObligationSnippet(snippet: string): boolean {
  return /\b(source-obligation|callback-obligation|residue-obligation|source-quote|story-anchor)\b/i.test(snippet)
    || /\[(source-obligation|callback-obligation|residue-obligation|source-quote|story-anchor)\]/i.test(snippet);
}

function isRepairSnippet(snippet: string): boolean {
  return /\b(repair-learning|validator-failure|repair route|prior failure|regression)\b/i.test(snippet)
    || /\[(repair-learning|validator-failure)\]/i.test(snippet);
}

function isValidatedSnippet(snippet: string): boolean {
  return snippet.startsWith('[validated ') || /\bvalidated\b/i.test(snippet);
}

export function composeMemoryPrompt(
  packets: PipelineMemoryPacket[],
  maxChars: number,
  budget: MemoryPromptBudget = DEFAULT_BUDGET,
): string | null {
  const snippets = Array.from(new Set(packets.flatMap((packet) => packet.sourceSnippets.map((s) => s.trim())).filter(Boolean)));
  if (!snippets.length) return null;

  const hardCanon: string[] = [];
  const obligations: string[] = [];
  const repair: string[] = [];
  const advisory: string[] = [];

  for (const snippet of snippets) {
    if (isValidatedSnippet(snippet)) hardCanon.push(snippet);
    else if (isObligationSnippet(snippet)) obligations.push(snippet);
    else if (isRepairSnippet(snippet)) repair.push(snippet);
    else advisory.push(snippet);
  }

  const sections = [
    hardCanon.length ? `Validated Facts:\n${hardCanon.map((s) => `- ${s}`).join('\n')}` : null,
    obligations.length ? `Obligations:\n${obligations.map((s) => `- ${s}`).join('\n')}` : null,
    repair.length ? `Repair Lessons:\n${repair.map((s) => `- ${s}`).join('\n')}` : null,
    advisory.length ? `Advisory Memory:\n${advisory.map((s) => `- ${s}`).join('\n')}` : null,
  ].filter(Boolean) as string[];

  const scaled = sections.map((section, index) => {
    const limits = [
      budget.hardCanonChars,
      budget.obligationsChars,
      budget.repairChars,
      budget.advisoryChars,
    ];
    return clip(section, limits[index] || budget.advisoryChars);
  });

  const rendered = scaled.join('\n\n');
  return clip(rendered, maxChars);
}
