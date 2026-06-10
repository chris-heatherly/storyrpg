/**
 * Pipeline memory persistence (Claude memory tool).
 *
 * Faithful port of FullStoryPipeline's memory methods (pure move):
 * generation-log + QA-learnings self-optimization entries, per-character
 * knowledge written after reference-sheet generation, and the read-side
 * used to seed agent prompts. All best-effort: failures log and never throw.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { PipelineConfig } from '../config';
import { getMemoryStore, NodeMemoryStore, type MemoryStore } from '../utils/memoryStore';

export interface PipelineMemoryDeps {
  config: PipelineConfig;
}

export class PipelineMemory {
  constructor(private deps: PipelineMemoryDeps) {}

  private get memoryEnabled(): boolean {
    return !!this.deps.config.memory?.enabled && this.deps.config.agents.storyArchitect.provider === 'anthropic';
  }

  private getMemoryStoreInstance(): MemoryStore {
    if (this.deps.config.memory?.directory) {
      return new NodeMemoryStore(this.deps.config.memory.directory);
    }
    return getMemoryStore();
  }

  /**
   * Write pipeline self-optimization data after a generation run.
   * Appends a timestamped entry with QA score, failures, and timing.
   */
  async writeGenerationMemory(opts: {
    success: boolean;
    qaScore?: number;
    qaPassed?: boolean;
    bestPracticesScore?: number;
    duration: number;
    artStyle?: string;
    failedAgents?: string[];
    timeoutAgents?: string[];
    error?: string;
    episodeTitle?: string;
  }): Promise<void> {
    if (!this.memoryEnabled || !this.deps.config.memory?.pipelineOptimization) return;
    try {
      const store = this.getMemoryStoreInstance();
      const ts = new Date().toISOString();
      const entry = [
        `\n## ${ts} — ${opts.episodeTitle || 'Generation'}`,
        `- Result: ${opts.success ? 'SUCCESS' : 'FAILED'}`,
        opts.qaScore != null ? `- QA Score: ${opts.qaScore}/100 (${opts.qaPassed ? 'passed' : 'needs revision'})` : null,
        opts.bestPracticesScore != null ? `- Best Practices Score: ${opts.bestPracticesScore}/100` : null,
        `- Duration: ${Math.round(opts.duration / 1000)}s`,
        opts.artStyle ? `- Art Style: ${opts.artStyle}` : null,
        opts.failedAgents?.length ? `- Failed Agents: ${opts.failedAgents.join(', ')}` : null,
        opts.timeoutAgents?.length ? `- Timeout Agents: ${opts.timeoutAgents.join(', ')}` : null,
        opts.error ? `- Error: ${opts.error.substring(0, 200)}` : null,
      ].filter(Boolean).join('\n');

      const path = '/memories/pipeline/generation-log.md';
      const existing = await store.execute({ command: 'view', path });
      if (existing.includes('does not exist')) {
        await store.execute({ command: 'create', path, file_text: `# Pipeline Generation Log\n\nAutomated log of generation results for self-optimization.\n${entry}\n` });
      } else {
        await store.execute({ command: 'insert', path, insert_line: 999999, insert_text: entry + '\n' });
      }
      console.log(`[Pipeline] Memory: wrote generation log entry (QA: ${opts.qaScore ?? 'n/a'})`);
    } catch (err) {
      console.warn('[Pipeline] Memory: failed to write generation log:', err);
    }
  }

  /**
   * Write detailed QA learnings that can guide future generations.
   * Extracts recurring patterns from voice, continuity, and stakes reports.
   */
  async writeQALearnings(qaReport: {
    continuity?: { issues: Array<{ description: string; severity: string; suggestedFix?: string }> };
    voice?: { characterScores: Array<{ characterName: string; score: number; weaknesses: string[] }>; recommendations: string[] };
    stakes?: { choiceSetAnalysis: Array<{ stakesScore: number; analysis: string; improvements: string[] }> };
    overallScore: number;
    criticalIssues: string[];
  }, episodeTitle?: string): Promise<void> {
    if (!this.memoryEnabled || !this.deps.config.memory?.pipelineOptimization) return;
    try {
      const store = this.getMemoryStoreInstance();
      const ts = new Date().toISOString();
      const lines: string[] = [`\n## ${ts} — ${episodeTitle || 'Generation'} (QA: ${qaReport.overallScore}/100)`];

      if (qaReport.voice?.characterScores) {
        const weakVoices = qaReport.voice.characterScores.filter(c => c.score < 70 && c.weaknesses.length > 0);
        if (weakVoices.length > 0) {
          lines.push('### Voice Issues');
          for (const v of weakVoices) {
            lines.push(`- ${v.characterName} (${v.score}/100): ${v.weaknesses.slice(0, 3).join('; ')}`);
          }
        }
        if (qaReport.voice.recommendations.length > 0) {
          lines.push(`- Recommendations: ${qaReport.voice.recommendations.slice(0, 3).join('; ')}`);
        }
      }

      if (qaReport.continuity?.issues) {
        const errors = qaReport.continuity.issues.filter(i => i.severity === 'error');
        if (errors.length > 0) {
          lines.push('### Continuity Errors');
          for (const e of errors.slice(0, 5)) {
            lines.push(`- ${e.description}${e.suggestedFix ? ` → ${e.suggestedFix}` : ''}`);
          }
        }
      }

      if (qaReport.stakes?.choiceSetAnalysis) {
        const weakStakes = qaReport.stakes.choiceSetAnalysis.filter(cs => cs.stakesScore < 50);
        if (weakStakes.length > 0) {
          lines.push('### Weak Stakes');
          for (const s of weakStakes.slice(0, 3)) {
            lines.push(`- Score ${s.stakesScore}: ${s.analysis.substring(0, 120)}`);
            if (s.improvements.length > 0) {
              lines.push(`  Fix: ${s.improvements.slice(0, 2).join('; ')}`);
            }
          }
        }
      }

      if (qaReport.criticalIssues.length > 0) {
        lines.push('### Critical Issues');
        for (const ci of qaReport.criticalIssues.slice(0, 5)) {
          lines.push(`- ${ci}`);
        }
      }

      if (lines.length <= 1) return;

      const entry = lines.join('\n');
      const path = '/memories/pipeline/qa-learnings.md';
      const existing = await store.execute({ command: 'view', path });
      if (existing.includes('does not exist')) {
        await store.execute({
          command: 'create',
          path,
          file_text: `# QA Learnings\n\nRecurring quality patterns extracted from generation QA reports.\nThese learnings are injected into agent prompts to prevent repeat issues.\n${entry}\n`,
        });
      } else {
        await store.execute({ command: 'insert', path, insert_line: 999999, insert_text: entry + '\n' });
      }
      console.log(`[Pipeline] Memory: wrote QA learnings (${lines.length - 1} pattern(s))`);
    } catch (err) {
      console.warn('[Pipeline] Memory: failed to write QA learnings:', err);
    }
  }

  /**
   * Write character knowledge after a character reference sheet is generated.
   * Stores vision analysis results, physical traits, and whether ref images matched.
   */
  async writeCharacterMemory(opts: {
    characterName: string;
    characterId: string;
    visionAnalysisSucceeded: boolean;
    physicalTraits: Record<string, any>;
    hadUserReferenceImages: boolean;
    userRefCount: number;
    generationSucceeded: boolean;
    artStyle?: string;
  }): Promise<void> {
    if (!this.memoryEnabled || !this.deps.config.memory?.characterKnowledge) return;
    try {
      const store = this.getMemoryStoreInstance();
      const safeName = opts.characterName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const path = `/memories/characters/${safeName}.md`;
      const ts = new Date().toISOString();

      const traits = opts.physicalTraits;
      const traitLines = Object.entries(traits)
        .filter(([_, v]) => v != null)
        .map(([k, v]) => `  - ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n');

      const entry = [
        `\n## ${ts}`,
        `- Character: ${opts.characterName} (${opts.characterId})`,
        `- User Reference Images: ${opts.hadUserReferenceImages ? `yes (${opts.userRefCount})` : 'none'}`,
        `- Vision Analysis: ${opts.visionAnalysisSucceeded ? 'succeeded' : 'FAILED'}`,
        `- Generation: ${opts.generationSucceeded ? 'succeeded' : 'failed'}`,
        opts.artStyle ? `- Art Style: ${opts.artStyle}` : null,
        `- Physical Traits Used:\n${traitLines || '  (none)'}`,
      ].filter(Boolean).join('\n');

      const existing = await store.execute({ command: 'view', path });
      if (existing.includes('does not exist')) {
        await store.execute({
          command: 'create',
          path,
          file_text: `# Character Knowledge: ${opts.characterName}\n\nPersisted across generations for improved reference matching.\n${entry}\n`,
        });
      } else {
        await store.execute({ command: 'insert', path, insert_line: 999999, insert_text: entry + '\n' });
      }
      console.log(`[Pipeline] Memory: wrote character knowledge for ${opts.characterName}`);
    } catch (err) {
      console.warn(`[Pipeline] Memory: failed to write character knowledge for ${opts.characterName}:`, err);
    }
  }

  /**
   * Read character knowledge from memory for a given character.
   * Returns the memory content or null if none exists.
   */
  async readCharacterMemory(characterName: string): Promise<string | null> {
    if (!this.memoryEnabled || !this.deps.config.memory?.characterKnowledge) return null;
    try {
      const store = this.getMemoryStoreInstance();
      const safeName = characterName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const path = `/memories/characters/${safeName}.md`;
      const result = await store.execute({ command: 'view', path });
      if (result.includes('does not exist')) return null;
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Read pipeline optimization memories.
   * Returns the generation log content or null if none exists.
   */
  async readPipelineMemory(): Promise<string | null> {
    if (!this.memoryEnabled || !this.deps.config.memory?.pipelineOptimization) return null;
    try {
      const store = this.getMemoryStoreInstance();
      const parts: string[] = [];

      const genLog = await store.execute({ command: 'view', path: '/memories/pipeline/generation-log.md' });
      if (!genLog.includes('does not exist')) {
        parts.push(genLog);
      }

      const qaLearnings = await store.execute({ command: 'view', path: '/memories/pipeline/qa-learnings.md' });
      if (!qaLearnings.includes('does not exist')) {
        parts.push(qaLearnings);
      }

      return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
    } catch {
      return null;
    }
  }
}
