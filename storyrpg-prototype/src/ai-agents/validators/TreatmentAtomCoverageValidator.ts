import type { Story, TreatmentEventAtom, TreatmentEventOwnership } from '../../types';

export interface TreatmentAtomCoverageIssue {
  validator: 'TreatmentAtomCoverageValidator';
  severity: 'error' | 'warning';
  type: 'missing_required_atom' | 'duplicate_atom_realization' | 'atom_out_of_order';
  message: string;
  atomId: string;
  sceneId?: string;
  path?: string;
}

export interface TreatmentAtomCoverageReport {
  passed: boolean;
  blockingIssues: TreatmentAtomCoverageIssue[];
  warnings: TreatmentAtomCoverageIssue[];
  ownership: TreatmentEventOwnership[];
}

export class TreatmentAtomCoverageValidator {
  validate(input: { story: Story; atoms: TreatmentEventAtom[] }): TreatmentAtomCoverageReport {
    const playableAtoms = input.atoms.filter((atom) => atom.isPlayableEvent);
    const scenes = flattenScenes(input.story);
    const blockingIssues: TreatmentAtomCoverageIssue[] = [];
    const ownership: TreatmentEventOwnership[] = [];
    let lastRealizedOrder = 0;

    for (const atom of playableAtoms) {
      const matches = scenes
        .map((scene) => ({
          scene,
          evidenceBeatIds: scene.beats
            .filter((beat) => textMatchesAtom(beat.text, atom))
            .map((beat) => beat.id),
        }))
        .filter((candidate) => candidate.evidenceBeatIds.length > 0);

      const primary = matches[0];
      if (!primary) {
        blockingIssues.push({
          validator: 'TreatmentAtomCoverageValidator',
          severity: 'error',
          type: 'missing_required_atom',
          message: `Required treatment atom "${atom.id}" was not dramatized in generated episode prose.`,
          atomId: atom.id,
        });
        ownership.push(emptyOwnership(atom, 'missing'));
        continue;
      }

      const duplicateSceneIds = matches.slice(1).map((match) => match.scene.scene.id);
      const chronologyStatus = atom.order < lastRealizedOrder ? 'out_of_order' : duplicateSceneIds.length > 0 ? 'duplicate' : 'ok';
      if (chronologyStatus === 'out_of_order') {
        blockingIssues.push({
          validator: 'TreatmentAtomCoverageValidator',
          severity: 'error',
          type: 'atom_out_of_order',
          message: `Treatment atom "${atom.id}" is realized after a later atom, breaking treatment chronology.`,
          atomId: atom.id,
          sceneId: primary.scene.scene.id,
          path: primary.scene.path,
        });
      }
      if (duplicateSceneIds.length > 0) {
        blockingIssues.push({
          validator: 'TreatmentAtomCoverageValidator',
          severity: 'error',
          type: 'duplicate_atom_realization',
          message: `Treatment atom "${atom.id}" is realized in multiple scenes: ${[primary.scene.scene.id, ...duplicateSceneIds].join(', ')}.`,
          atomId: atom.id,
          sceneId: primary.scene.scene.id,
          path: primary.scene.path,
        });
      }
      lastRealizedOrder = Math.max(lastRealizedOrder, atom.order);
      ownership.push({
        atomId: atom.id,
        sceneId: primary.scene.scene.id,
        ownershipKind: 'primary',
        realizationStatus: chronologyStatus === 'ok' ? 'realized' : chronologyStatus,
        evidenceBeatIds: primary.evidenceBeatIds,
        duplicateSceneIds,
        chronologyStatus,
      });
    }

    return {
      passed: blockingIssues.length === 0,
      blockingIssues,
      warnings: [],
      ownership,
    };
  }
}

function flattenScenes(story: Story): Array<{ scene: NonNullable<Story['episodes'][number]['scenes']>[number]; beats: Array<{ id: string; text?: string }>; path: string }> {
  return (story.episodes || []).flatMap((episode, episodeIndex) =>
    (episode.scenes || []).map((scene, sceneIndex) => ({
      scene,
      beats: (scene.beats || []).map((beat) => ({ id: beat.id, text: beat.text })),
      path: `episodes[${episodeIndex}].scenes[${sceneIndex}]`,
    })),
  );
}

function textMatchesAtom(text: string | undefined, atom: TreatmentEventAtom): boolean {
  if (!text) return false;
  const haystack = normalize(text);
  const tokens = normalize(atom.eventText)
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .filter((token) => !STOPWORDS.has(token));
  if (tokens.length === 0) return false;
  const required = Math.min(tokens.length, Math.max(2, Math.ceil(tokens.length * 0.45)));
  return tokens.filter((token) => haystack.includes(token)).length >= required;
}

function emptyOwnership(atom: TreatmentEventAtom, status: TreatmentEventOwnership['realizationStatus']): TreatmentEventOwnership {
  return {
    atomId: atom.id,
    sceneId: '',
    ownershipKind: 'primary',
    realizationStatus: status,
    evidenceBeatIds: [],
    duplicateSceneIds: [],
    chronologyStatus: status === 'missing' ? 'missing' : 'not_playable',
  };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set(['this', 'that', 'with', 'from', 'into', 'onto', 'after', 'before', 'then', 'they', 'their', 'them']);
