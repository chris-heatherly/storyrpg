import type {
  NarrativeEvidenceAtom,
  NarrativeVerificationAuthority,
} from '../../types/narrativeContract';

const STRUCTURED_PREFIX = /^(?:milestone|group|consequence|evidence):/i;

/**
 * Version-7 compatibility rule. Version-8 artifacts persist the result so a
 * validator never silently changes authority when matching code changes.
 */
export function inferNarrativeVerificationAuthority(
  atom: NarrativeEvidenceAtom,
): NarrativeVerificationAuthority {
  if (atom.verificationAuthority) return atom.verificationAuthority;
  if (atom.acceptedPatterns.some((pattern) => STRUCTURED_PREFIX.test(pattern.trim()))) {
    return 'structured';
  }
  if (atom.kind === 'lexical' || atom.kind === 'relationship_label') return 'literal';
  if (atom.matchStrategy === 'location_identity' || atom.matchStrategy === 'temporal_orientation') {
    return 'literal';
  }
  return 'semantic_judge';
}

export function withNarrativeVerificationAuthority(
  atom: NarrativeEvidenceAtom,
): NarrativeEvidenceAtom {
  const verificationAuthority = inferNarrativeVerificationAuthority(atom);
  if (atom.verificationAuthority === verificationAuthority) return atom;
  return { ...atom, verificationAuthority };
}

export function isSemanticNarrativeAtom(atom: NarrativeEvidenceAtom): boolean {
  return inferNarrativeVerificationAuthority(atom) === 'semantic_judge';
}

export function isDeterministicNarrativeAtom(atom: NarrativeEvidenceAtom): boolean {
  return inferNarrativeVerificationAuthority(atom) !== 'semantic_judge';
}
