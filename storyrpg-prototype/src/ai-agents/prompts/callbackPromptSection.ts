// ========================================
// CALLBACK PROMPT SECTION
// ========================================
//
// Builds the prompt fragment that injects unresolved CallbackHooks into
// SceneWriter / ChoiceAuthor user prompts. Consumed by FullStoryPipeline.
//
// Design goals:
//   - Small: 1 paragraph of framing + a short bullet list.
//   - Optional: if there are no unresolved hooks, we return empty string so
//     the prompt is unchanged (prevents LLM from inventing callbacks out of
//     thin air in episode 1).
//   - Cost-aware: hard-caps to the 5 most recent hooks regardless of how many
//     the ledger holds.

import type { CallbackHook } from '../pipeline/callbackLedger';

const MAX_HOOKS_IN_PROMPT = 5;

export interface CallbackPromptOptions {
  /** Maximum number of recent hooks to inject. Default 5. */
  maxHooks?: number;
  /** Whether to show the "Seed NEW memorable moments" half of the prompt. */
  authorNewHooks?: boolean;
}

/**
 * Build the SceneWriter-facing section. SceneWriter acknowledges prior
 * callbacks via TextVariants; it doesn't seed new ones.
 */
export function buildSceneWriterCallbackSection(
  hooks: CallbackHook[],
  options?: CallbackPromptOptions,
): string {
  if (hooks.length === 0) return '';
  const cap = Math.min(hooks.length, options?.maxHooks ?? MAX_HOOKS_IN_PROMPT);
  const subset = hooks.slice(0, cap);

  const lines = [
    '',
    '## Prior-Episode Memorable Moments (unresolved callbacks)',
    '',
    'The player made these notable choices in earlier episodes. Each is still',
    'unresolved — no scene has yet paid it off. Reference AT LEAST ONE in this',
    "scene via a TextVariant gated on the choice's flag. Keep it natural —",
    "don't force a callback if the scene topic is unrelated; prefer NPC asides,",
    'reputation mentions, or environmental echoes.',
    '',
    'Unresolved hooks:',
  ];
  for (const hook of subset) {
    const flagList = hook.flags.length > 0 ? ` (flags: ${hook.flags.join(', ')})` : '';
    lines.push(`  - id: "${hook.id}" — ep ${hook.sourceEpisode}: ${hook.summary}${flagList}`);
  }
  lines.push(
    '',
    'When you author a TextVariant that references one of these hooks, set',
    'the `callbackHookId` field on the variant to the hook id exactly. The',
    'variant condition should gate on one of the hook\'s flags.',
    '',
    'Max 2 callback variants per scene. Do NOT invent new hook ids.',
    '',
  );
  return lines.join('\n');
}

/**
 * Build the ChoiceAuthor-facing section. ChoiceAuthor also sees unresolved
 * hooks (so new choices can gate on them via conditions), AND is invited to
 * TAG notable new choices with `memorableMoment` for the next episode.
 */
export function buildChoiceAuthorCallbackSection(
  hooks: CallbackHook[],
  options?: CallbackPromptOptions,
): string {
  const authorNew = options?.authorNewHooks ?? true;
  const priorSection = buildPriorHooksSnippet(hooks, options?.maxHooks ?? MAX_HOOKS_IN_PROMPT);
  if (!authorNew && !priorSection) return '';

  const lines: string[] = [''];

  if (priorSection) {
    lines.push(priorSection);
  }

  if (authorNew) {
    lines.push(
      '',
      '## Seeding NEW Memorable Moments',
      '',
      'If this scene contains a choice that the player should FEEL in later',
      'episodes (moral weight, relationship impact, identity shift), attach',
      'a `memorableMoment` object to that choice:',
      '',
      '  "memorableMoment": {',
      '    "id": "slug-style-id",        // unique, kebab-case',
      '    "summary": "You spared the herald.",  // one sentence, past tense',
      '    "flags": ["spared-herald"]    // optional; falls back to setFlag consequences',
      '  }',
      '',
      'Rules:',
      '  - At most 1 choice per scene gets a memorableMoment.',
      '  - The id must be unique across the whole story — prefer specific verbs.',
      '  - Only tag choices that have real downstream consequences (setFlag/addTag/adjustRelationship).',
      '  - Expression choices never get memorableMoments.',
      '',
    );
  }

  return lines.join('\n');
}

function buildPriorHooksSnippet(hooks: CallbackHook[], cap: number): string {
  if (hooks.length === 0) return '';
  const subset = hooks.slice(0, Math.min(hooks.length, cap));
  const lines = [
    '## Prior-Episode Memorable Moments',
    '',
    'The player\'s unresolved memorable moments from earlier episodes:',
  ];
  for (const hook of subset) {
    const flagList = hook.flags.length > 0 ? ` [flags: ${hook.flags.join(', ')}]` : '';
    lines.push(`  - ${hook.id}: ${hook.summary}${flagList}`);
  }
  lines.push(
    '',
    'You MAY gate a choice condition on one of these flags to make it only',
    'appear for players who triggered the original moment. Do not invent',
    'new hook ids here — only SceneWriter\'s text variants reference existing hooks.',
  );
  return lines.join('\n');
}
