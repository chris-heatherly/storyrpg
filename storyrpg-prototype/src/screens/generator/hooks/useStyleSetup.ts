/**
 * useStyleSetup
 *
 * Local state machine for the inline Style Setup section on the
 * analysis_complete screen. Owns:
 *  - the in-progress `ArtStyleProfile` (after StyleArchitect expansion
 *    and any manual edits the user makes)
 *  - three concept anchor slots (character, arc strip, environment),
 *    each with its own status (idle | generating | ready | approved | stale | error)
 *  - the handoff payload the generator hands to `buildPipelineConfig`'s
 *    `extras` argument when the user clicks INITIATE GENERATION
 *
 * The hook is deliberately decoupled from the concrete LLM and image
 * services: callers pass in `expandStyleFn`, `generateAnchorImageFn`,
 * and `saveAnchorFn` so tests and alternate transports (Atlas Cloud,
 * Midjourney, a server-side RPC) can all plug in. GeneratorScreen
 * wires the default implementations backed by `StyleArchitect` and the
 * image provider configured elsewhere on that screen.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ArtStyleProfile } from '../../../ai-agents/images/artStyleProfile';
import {
  buildVerbatimProfile,
  composeCanonicalStyleString,
} from '../../../ai-agents/images/artStyleProfile';
import {
  buildArcStripAnchorPrompt,
  buildCharacterAnchorPrompt,
  buildEnvironmentAnchorPrompt,
  type BuiltAnchorPrompt,
} from '../../../ai-agents/images/anchorPrompts';

export type AnchorRole = 'character' | 'arcStrip' | 'environment';

export type AnchorStatus =
  | 'idle'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'stale'
  | 'error';

export interface AnchorSlot {
  status: AnchorStatus;
  imageBase64?: string;
  mimeType?: string;
  imagePath?: string;
  error?: string;
}

export interface StyleSetupHandoff {
  profile?: ArtStyleProfile;
  preapprovedStyleAnchors?: {
    character?: { data?: string; mimeType?: string; imagePath?: string };
    arcStrip?: { data?: string; mimeType?: string; imagePath?: string };
    environment?: { data?: string; mimeType?: string; imagePath?: string };
  };
}

export interface UseStyleSetupOptions {
  /** The raw art-style string the user typed on the config step. */
  rawArtStyle: string;
  /** Title of the story, used for anchor prompt flavor text. */
  storyTitle: string;
  /** Protagonist name from the analyzed source. */
  protagonistName: string;
  /** Up to three color-script terms from the source analysis, if available. */
  colorTerms?: string[];
  /** Primary location name, if known. */
  primaryLocation?: string;
  /** LLM expansion backend — usually `new StyleArchitect(config).expand`. */
  expandStyleFn: (raw: string) => Promise<ArtStyleProfile>;
  /**
   * Image-generation backend. Returns base64 + mime for a freshly rendered
   * concept anchor. Throws or rejects on failure.
   */
  generateAnchorImageFn: (
    role: AnchorRole,
    prompt: BuiltAnchorPrompt['prompt'],
  ) => Promise<{ data: string; mimeType: string }>;
  /**
   * Optional persistence step. When provided, called after a user approves
   * an anchor; the returned imagePath is threaded into the pipeline handoff
   * so the worker can read the file off disk instead of re-shipping the
   * base64 blob. When absent, the handoff falls back to inline base64.
   */
  saveAnchorFn?: (
    role: AnchorRole,
    data: string,
    mimeType: string,
  ) => Promise<{ imagePath: string }>;
}

const INITIAL_SLOT: AnchorSlot = { status: 'idle' };

/**
 * Small helper — when the user edits any DNA field, we cannot keep the
 * existing preview as "approved" because it no longer reflects the
 * current profile. Mark approved slots as stale so the UI can prompt
 * the user to regenerate.
 */
function demoteApprovedToStale(slots: Record<AnchorRole, AnchorSlot>): Record<AnchorRole, AnchorSlot> {
  const next: Record<AnchorRole, AnchorSlot> = { ...slots };
  (Object.keys(slots) as AnchorRole[]).forEach((role) => {
    if (slots[role].status === 'approved' || slots[role].status === 'ready') {
      next[role] = { ...slots[role], status: 'stale' };
    }
  });
  return next;
}

export function useStyleSetup(options: UseStyleSetupOptions) {
  const [profile, setProfile] = useState<ArtStyleProfile | undefined>(undefined);
  const [expanding, setExpanding] = useState(false);
  const [expansionError, setExpansionError] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<AnchorRole, AnchorSlot>>({
    character: INITIAL_SLOT,
    arcStrip: INITIAL_SLOT,
    environment: INITIAL_SLOT,
  });
  const [useDefaults, setUseDefaultsState] = useState(false);

  // Keep a ref to the last-approved profile snapshot so we can diff edits.
  const approvedProfileRef = useRef<ArtStyleProfile | undefined>(undefined);

  const expand = useCallback(async () => {
    const raw = options.rawArtStyle.trim();
    if (!raw) {
      setExpansionError('Enter an art style on the config step before expanding.');
      return;
    }
    setExpanding(true);
    setExpansionError(null);
    try {
      const resolved = await options.expandStyleFn(raw);
      setProfile(resolved);
      approvedProfileRef.current = resolved;
      setSlots({
        character: INITIAL_SLOT,
        arcStrip: INITIAL_SLOT,
        environment: INITIAL_SLOT,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExpansionError(message);
      setProfile(buildVerbatimProfile(raw));
    } finally {
      setExpanding(false);
    }
  }, [options]);

  const updateField = useCallback(
    <K extends keyof ArtStyleProfile>(field: K, value: ArtStyleProfile[K]) => {
      setProfile((current) => {
        if (!current) return current;
        const next = { ...current, [field]: value };
        setSlots((slotsNow) => demoteApprovedToStale(slotsNow));
        return next;
      });
    },
    [],
  );

  const generateAnchor = useCallback(
    async (role: AnchorRole) => {
      if (!profile) return;
      const style = composeCanonicalStyleString(profile);
      let built: BuiltAnchorPrompt;
      if (role === 'character') {
        built = buildCharacterAnchorPrompt({
          style,
          protagonistName: options.protagonistName,
          colorTerms: options.colorTerms,
        });
      } else if (role === 'arcStrip') {
        built = buildArcStripAnchorPrompt({
          style,
          storyTitle: options.storyTitle,
        });
      } else {
        built = buildEnvironmentAnchorPrompt({
          style,
          storyTitle: options.storyTitle,
          locationName: options.primaryLocation,
          toneTerms: options.colorTerms?.slice(0, 2),
        });
      }

      setSlots((prev) => ({ ...prev, [role]: { status: 'generating' } }));
      try {
        const result = await options.generateAnchorImageFn(role, built.prompt);
        setSlots((prev) => ({
          ...prev,
          [role]: {
            status: 'ready',
            imageBase64: result.data,
            mimeType: result.mimeType,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSlots((prev) => ({ ...prev, [role]: { status: 'error', error: message } }));
      }
    },
    [profile, options],
  );

  const approveAnchor = useCallback(
    async (role: AnchorRole) => {
      const slot = slots[role];
      if (slot.status !== 'ready') return;
      if (options.saveAnchorFn && slot.imageBase64 && slot.mimeType) {
        try {
          const { imagePath } = await options.saveAnchorFn(role, slot.imageBase64, slot.mimeType);
          setSlots((prev) => ({
            ...prev,
            [role]: { ...prev[role], status: 'approved', imagePath },
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSlots((prev) => ({ ...prev, [role]: { ...prev[role], status: 'error', error: message } }));
        }
        return;
      }
      setSlots((prev) => ({ ...prev, [role]: { ...prev[role], status: 'approved' } }));
      approvedProfileRef.current = profile;
    },
    [slots, options, profile],
  );

  const setUseDefaults = useCallback((value: boolean) => {
    setUseDefaultsState(value);
    if (value) {
      setSlots({
        character: INITIAL_SLOT,
        arcStrip: INITIAL_SLOT,
        environment: INITIAL_SLOT,
      });
    }
  }, []);

  const reset = useCallback(() => {
    setProfile(undefined);
    setExpansionError(null);
    setExpanding(false);
    setSlots({
      character: INITIAL_SLOT,
      arcStrip: INITIAL_SLOT,
      environment: INITIAL_SLOT,
    });
    approvedProfileRef.current = undefined;
    setUseDefaultsState(false);
  }, []);

  const handoff = useMemo<StyleSetupHandoff>(() => {
    if (useDefaults) return {};
    if (!profile) return {};
    const anchors: StyleSetupHandoff['preapprovedStyleAnchors'] = {};
    (Object.keys(slots) as AnchorRole[]).forEach((role) => {
      const slot = slots[role];
      if (slot.status === 'approved') {
        anchors[role] = slot.imagePath
          ? { imagePath: slot.imagePath }
          : { data: slot.imageBase64, mimeType: slot.mimeType };
      }
    });
    const hasAnyAnchor = !!(anchors.character || anchors.arcStrip || anchors.environment);
    return {
      profile,
      preapprovedStyleAnchors: hasAnyAnchor ? anchors : undefined,
    };
  }, [profile, slots, useDefaults]);

  const statusSummary = useMemo(() => {
    if (useDefaults) return 'Using heuristic defaults — pipeline will build the style bible from scratch.';
    if (expanding) return 'Expanding your style into a full profile…';
    if (expansionError) return `Style expansion failed: ${expansionError}`;
    if (!profile) return 'Click Expand to translate your style string into an editable profile.';
    const counts = {
      approved: 0,
      ready: 0,
      generating: 0,
      stale: 0,
      idle: 0,
      error: 0,
    };
    (Object.values(slots) as AnchorSlot[]).forEach((slot) => {
      counts[slot.status] = (counts[slot.status] as number) + 1;
    });
    const parts: string[] = [];
    if (counts.approved) parts.push(`${counts.approved} approved`);
    if (counts.ready) parts.push(`${counts.ready} ready`);
    if (counts.generating) parts.push(`${counts.generating} generating`);
    if (counts.stale) parts.push(`${counts.stale} stale (profile edited)`);
    if (counts.error) parts.push(`${counts.error} failed`);
    if (parts.length === 0) return 'Profile ready — preview anchors below.';
    return `Anchors: ${parts.join(', ')}.`;
  }, [useDefaults, expanding, expansionError, profile, slots]);

  return {
    profile,
    slots,
    expanding,
    expansionError,
    useDefaults,
    handoff,
    statusSummary,
    expand,
    updateField,
    generateAnchor,
    approveAnchor,
    setUseDefaults,
    reset,
  };
}
