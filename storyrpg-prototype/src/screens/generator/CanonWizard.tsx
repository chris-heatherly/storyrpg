import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Wand2 } from 'lucide-react-native';
import { TERMINAL } from '../../theme';
import type { SeasonPlan, EpisodeRecommendation } from '../../types/seasonPlan';
import type {
  CanonEditRepairSuggestion,
  CanonEditValidationResult,
  CanonFact,
  CanonWizardState,
  CanonWizardStep,
  LockedStoryCanon,
} from '../../types/storyCanon';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import { EpisodeSelector } from '../../components/EpisodeSelector';
import {
  applyCanonEditProposal,
  buildCanonEditProposal,
  canonStepForFact,
  commitCanonStep,
  createCanonWizardState,
  deterministicCanonRepairSuggestion,
  updateWizardStateAfterApproval,
  updateWizardStateAfterEdit,
} from '../../ai-agents/utils/sourceCanonEditor';

const STEP_LABELS: Record<CanonWizardStep, string> = {
  story: 'STORY CANON',
  peopleWorld: 'PEOPLE & WORLD',
  episodesEndings: 'EPISODES & ENDINGS',
};

const STEP_ORDER: CanonWizardStep[] = ['story', 'peopleWorld', 'episodesEndings'];

const STORY_CIRCLE_LABELS: Record<string, string> = {
  you: 'YOU',
  need: 'NEED',
  go: 'GO',
  search: 'SEARCH',
  find: 'FIND',
  take: 'TAKE',
  return: 'RETURN',
  change: 'CHANGE',
};

type CanonWizardProps = {
  canon: LockedStoryCanon;
  wizardState?: CanonWizardState | null;
  seasonPlan?: SeasonPlan | null;
  selectedEpisodes: number[];
  recommendations?: EpisodeRecommendation[];
  warnings?: string[];
  onCanonChange: (canon: LockedStoryCanon, wizardState: CanonWizardState) => void;
  onStepApproved: (canon: LockedStoryCanon, wizardState: CanonWizardState) => void;
  onStepChange?: (step: CanonWizardStep) => void;
  onEpisodeSelectionChange: (episodeNumbers: number[]) => void;
  onRequestRepairSuggestion?: (validation: CanonEditValidationResult, canon: LockedStoryCanon) => Promise<CanonEditRepairSuggestion | null>;
};

function renderValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(renderValue).filter(Boolean).join('\n');
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function parseValue(raw: string, mode?: 'lines' | 'csv' | 'number' | 'numberCsv'): unknown {
  if (mode === 'lines') return raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (mode === 'csv') return raw.split(/[,\n]/).map((line) => line.trim()).filter(Boolean);
  if (mode === 'numberCsv') return raw.split(/[,\n]/).map((line) => Number(line.trim())).filter((value) => Number.isFinite(value) && value > 0);
  if (mode === 'number') return Number(raw) || 0;
  return raw;
}

function getField(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function factTitle(fact: CanonFact): string {
  if (fact.domain === 'story_circle' && fact.kind === 'beat') return STORY_CIRCLE_LABELS[fact.subjectId] || fact.subjectId.toUpperCase();
  if (fact.domain === 'story_circle' && fact.kind.startsWith('polarity_')) return String((fact.value as any).label || fact.kind).toUpperCase();
  const value = fact.value as { name?: string; title?: string };
  return String(value.name || value.title || fact.subjectId).toUpperCase();
}

function factsForStep(canon: LockedStoryCanon, step: CanonWizardStep): CanonFact[] {
  return canon.facts.filter((fact) => canonStepForFact(fact) === step);
}

function factBy(canon: LockedStoryCanon, domain: CanonFact['domain'], kind: string, subjectId?: string): CanonFact | undefined {
  return canon.facts.find((fact) =>
    fact.domain === domain
    && fact.kind === kind
    && (!subjectId || fact.subjectId === subjectId)
  );
}

type FieldSpec = {
  label: string;
  path: string;
  multiline?: boolean;
  mode?: 'lines' | 'csv' | 'number' | 'numberCsv';
};

function FieldEditor({
  fact,
  field,
  onChange,
}: {
  fact: CanonFact;
  field: FieldSpec;
  onChange: (fact: CanonFact, field: FieldSpec, value: string) => void;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{field.label}</Text>
      <TextInput
        value={renderValue(getField(fact.value, field.path))}
        onChangeText={(value) => onChange(fact, field, value)}
        style={[styles.input, field.multiline ? styles.inputMultiline : null]}
        multiline={field.multiline}
      />
    </View>
  );
}

function FactCard({
  fact,
  fields,
  onChange,
}: {
  fact: CanonFact;
  fields: FieldSpec[];
  onChange: (fact: CanonFact, field: FieldSpec, value: string) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{factTitle(fact)}</Text>
        <Text style={styles.cardMeta}>{fact.domain}/{fact.kind}</Text>
      </View>
      {fields.map((field) => (
        <FieldEditor
          key={`${fact.id}:${field.path}`}
          fact={fact}
          field={field}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

export function CanonWizard({
  canon,
  wizardState,
  seasonPlan,
  selectedEpisodes,
  recommendations = [],
  warnings = [],
  onCanonChange,
  onStepApproved,
  onStepChange,
  onEpisodeSelectionChange,
  onRequestRepairSuggestion,
}: CanonWizardProps) {
  const state = wizardState || createCanonWizardState(canon, selectedEpisodes);
  const activeStep = state.activeStep;
  const [validation, setValidation] = useState<CanonEditValidationResult | null>(null);
  const [repairSuggestion, setRepairSuggestion] = useState<CanonEditRepairSuggestion | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);

  const editField = (fact: CanonFact, field: FieldSpec, rawValue: string) => {
    const proposal = buildCanonEditProposal(canon, fact.id, field.path, parseValue(rawValue, field.mode));
    if (!proposal) return;
    const nextCanon = applyCanonEditProposal(canon, proposal);
    const nextState = updateWizardStateAfterEdit(state, nextCanon, canonStepForFact(fact));
    onCanonChange(nextCanon, nextState);
  };

  const approveStep = async () => {
    const totalEpisodes = seasonPlan?.totalEpisodes || canon.facts.filter((fact) => fact.domain === 'episode').length || 1;
    const committed = commitCanonStep(canon, activeStep, totalEpisodes);
    const nextValidation = committed.validation;
    let suggestion = nextValidation.suggestion || null;
    if (!nextValidation.passed) {
      setRepairLoading(true);
      try {
        const llmSuggestion = await onRequestRepairSuggestion?.(nextValidation, canon);
        if (llmSuggestion) suggestion = llmSuggestion;
      } finally {
        setRepairLoading(false);
      }
      if (!suggestion) suggestion = deterministicCanonRepairSuggestion(nextValidation.blockingConflicts);
      setValidation(nextValidation);
      setRepairSuggestion(suggestion);
      return;
    }
    const nextState = updateWizardStateAfterApproval(state, committed.canon, activeStep, nextValidation);
    onStepApproved(committed.canon, nextState);
  };

  const acceptRepairSuggestion = () => {
    if (!repairSuggestion) return;
    let nextCanon = canon;
    for (const patch of repairSuggestion.proposedPatches) {
      const proposal = buildCanonEditProposal(nextCanon, patch.factId, patch.fieldPath, patch.nextValue);
      if (!proposal) continue;
      nextCanon = applyCanonEditProposal(nextCanon, proposal);
    }
    const nextState = updateWizardStateAfterEdit(state, nextCanon, activeStep);
    setValidation(null);
    setRepairSuggestion(null);
    onCanonChange(nextCanon, nextState);
  };

  const moveToStep = (step: CanonWizardStep) => {
    onStepChange?.(step);
    onCanonChange(canon, { ...state, activeStep: step });
  };

  const storyIdentity = factBy(canon, 'story', 'identity');
  const storyPromise = factBy(canon, 'story', 'promise');
  const storyCircleFacts = STORY_CIRCLE_BEATS
    .map((beat) => factBy(canon, 'story_circle', 'beat', beat))
    .filter((fact): fact is CanonFact => Boolean(fact));
  const polarityFacts = canon.facts.filter((fact) => fact.domain === 'story_circle' && fact.kind.startsWith('polarity_'));
  const arcFacts = canon.facts.filter((fact) => fact.domain === 'arc' && fact.kind === 'arc');
  const peopleWorldFacts = factsForStep(canon, 'peopleWorld');
  const episodeFacts = canon.facts.filter((fact) => fact.domain === 'episode' && fact.kind === 'episode_profile')
    .sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
  const endingFacts = canon.facts.filter((fact) => fact.domain === 'ending' && fact.kind === 'ending_profile');
  const allApproved = STEP_ORDER.every((step) => state.stepStatus[step] === 'approved');

  const statusSummary = useMemo(() => STEP_ORDER.map((step) => ({
    step,
    label: STEP_LABELS[step],
    status: state.stepStatus[step],
  })), [state.stepStatus]);

  return (
    <View style={styles.container}>
      <View style={styles.stepTabs}>
        {statusSummary.map((item) => (
          <TouchableOpacity
            key={item.step}
            style={[styles.stepTab, activeStep === item.step ? styles.stepTabActive : null]}
            onPress={() => moveToStep(item.step)}
          >
            <Text style={[styles.stepTabText, activeStep === item.step ? styles.stepTabTextActive : null]}>{item.label}</Text>
            <Text style={[styles.stepTabStatus, item.status === 'approved' ? styles.approvedText : item.status === 'invalidated' ? styles.warningText : null]}>
              {item.status.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {state.validationIssues.length > 0 ? (
        <View style={styles.warningPanel}>
          <AlertTriangle size={14} color={TERMINAL.colors.amber} />
          <Text style={styles.warningPanelText}>{state.validationIssues[0].message}</Text>
        </View>
      ) : null}

      <ScrollView style={styles.stepBody} nestedScrollEnabled>
        {activeStep === 'story' ? (
          <>
            {storyIdentity ? (
              <FactCard
                fact={storyIdentity}
                fields={[
                  { label: 'TITLE', path: 'title' },
                  { label: 'GENRE', path: 'genre' },
                  { label: 'TONE', path: 'tone' },
                ]}
                onChange={editField}
              />
            ) : null}
            {storyPromise ? (
              <FactCard
                fact={storyPromise}
                fields={[
                  { label: 'HIGH CONCEPT PITCH', path: 'highConceptPitch', multiline: true },
                  { label: 'LOGLINE', path: 'logline', multiline: true },
                  { label: 'CORE FANTASY', path: 'coreFantasy', multiline: true },
                  { label: 'THEMES', path: 'themes', multiline: true, mode: 'lines' },
                  { label: 'AUDIENCE PROMISE', path: 'audiencePromise', multiline: true },
                ]}
                onChange={editField}
              />
            ) : null}
            {storyCircleFacts.map((fact) => (
              <FactCard
                key={fact.id}
                fact={fact}
                fields={[
                  { label: 'CANON TEXT', path: 'text', multiline: true },
                  { label: 'TARGET EPISODES', path: 'targetEpisodeNumbers', mode: 'numberCsv' },
                ]}
                onChange={editField}
              />
            ))}
            {polarityFacts.map((fact) => (
              <FactCard
                key={fact.id}
                fact={fact}
                fields={[
                  { label: 'LABEL', path: 'label' },
                  { label: 'TENSION', path: 'tension', multiline: true },
                ]}
                onChange={editField}
              />
            ))}
            {arcFacts.map((fact) => (
              <FactCard
                key={fact.id}
                fact={fact}
                fields={[
                  { label: 'NAME', path: 'name' },
                  { label: 'DESCRIPTION', path: 'description', multiline: true },
                  { label: 'EPISODE RANGE START', path: 'episodeRange.start', mode: 'number' },
                  { label: 'EPISODE RANGE END', path: 'episodeRange.end', mode: 'number' },
                  { label: 'STORY CIRCLE SPAN', path: 'storyCircleSpan.ownedBeats', mode: 'csv' },
                  { label: 'ARC QUESTION', path: 'arcQuestion', multiline: true },
                  { label: 'PRESSURE MOVEMENT', path: 'pressureMovement', multiline: true },
                  { label: 'PROTAGONIST POLARITY', path: 'protagonistPolarity', multiline: true },
                  { label: 'PRESSURE SOURCE', path: 'pressureSource', multiline: true },
                  { label: 'HANDOFF', path: 'handoff', multiline: true },
                ]}
                onChange={editField}
              />
            ))}
          </>
        ) : null}

        {activeStep === 'peopleWorld' ? peopleWorldFacts.map((fact) => {
          const fields: FieldSpec[] = fact.domain === 'character'
            ? [
                { label: 'NAME', path: 'name' },
                { label: 'PRONOUNS', path: 'pronouns' },
                { label: 'ROLE', path: 'role', multiline: true },
                { label: 'WANT', path: 'want', multiline: true },
                { label: 'NEED', path: 'need', multiline: true },
                { label: 'LIE OR SURVIVAL POSTURE', path: 'lieOrSurvivalPosture', multiline: true },
                { label: 'ORIGIN PRESSURE', path: 'originPressure', multiline: true },
                { label: 'TRUTH OR TRANSFORMATION', path: 'truthOrTransformation', multiline: true },
                { label: 'STARTING IDENTITY', path: 'startingIdentity', multiline: true },
                { label: 'POSSIBLE END STATES', path: 'possibleEndStates', multiline: true, mode: 'lines' },
                { label: 'VISUAL IDENTITY', path: 'visualIdentity', multiline: true },
              ]
            : fact.domain === 'npc'
              ? [
                  { label: 'NAME', path: 'name' },
                  { label: 'ROLE', path: 'role' },
                  { label: 'WANT', path: 'want', multiline: true },
                  { label: 'LEVERAGE', path: 'leverage', multiline: true },
                  { label: 'SECRET OR CONTRADICTION', path: 'secretOrContradiction', multiline: true },
                  { label: 'RELATIONSHIP TO PROTAGONIST', path: 'relationshipToProtagonist', multiline: true },
                  { label: 'VOICE OR VISUAL NOTES', path: 'voiceOrVisualNotes', multiline: true },
                ]
              : fact.domain === 'world'
                ? [
                    { label: 'PREMISE', path: 'premise', multiline: true },
                    { label: 'TIME PERIOD', path: 'timePeriod' },
                    { label: 'DRAMA RULES', path: 'dramaRules', multiline: true, mode: 'lines' },
                  ]
                : [
                    { label: 'NAME', path: 'name' },
                    { label: 'PURPOSE', path: 'purpose', multiline: true },
                    { label: 'MOOD', path: 'mood' },
                    { label: 'CHOICE PRESSURE', path: 'choicePressure', multiline: true },
                  ];
          return <FactCard key={fact.id} fact={fact} fields={fields} onChange={editField} />;
        }) : null}

        {activeStep === 'episodesEndings' ? (
          <>
            {episodeFacts.map((fact) => (
              <FactCard
                key={fact.id}
                fact={fact}
                fields={[
                  { label: 'TITLE', path: 'title' },
                  { label: 'STORY CIRCLE ROLE', path: 'storyCircleRole', mode: 'csv' },
                  { label: 'HIGH-LEVEL DESCRIPTION', path: 'highLevelDescription', multiline: true },
                  { label: 'MAJOR PRESSURE', path: 'majorPressure', multiline: true },
                  { label: 'LIKELY CONSEQUENCE', path: 'likelyConsequence', multiline: true },
                ]}
                onChange={editField}
              />
            ))}
            {endingFacts.map((fact) => (
              <FactCard
                key={fact.id}
                fact={fact}
                fields={[
                  { label: 'NAME', path: 'name' },
                  { label: 'EMOTIONAL DESTINATION', path: 'emotionalDestination', multiline: true },
                  { label: 'THEMATIC MEANING', path: 'thematicMeaning', multiline: true },
                  { label: 'REPEATED PATTERN OR STATE DRIVER', path: 'repeatedPatternOrStateDriver', multiline: true },
                  { label: 'TARGET CONDITIONS', path: 'targetConditions', multiline: true, mode: 'lines' },
                ]}
                onChange={editField}
              />
            ))}
            {seasonPlan ? (
              <View style={styles.selectorWrap}>
                <Text style={styles.subTitle}>SELECT EPISODES TO GENERATE</Text>
                <EpisodeSelector
                  seasonPlan={seasonPlan}
                  selectedEpisodes={selectedEpisodes}
                  onSelectionChange={onEpisodeSelectionChange}
                  recommendations={recommendations}
                  warnings={warnings}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.secondaryButton, activeStep === 'story' ? styles.buttonDisabled : null]}
          disabled={activeStep === 'story'}
          onPress={() => moveToStep(STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(activeStep) - 1)])}
        >
          <ChevronLeft size={16} color={activeStep === 'story' ? TERMINAL.colors.muted : TERMINAL.colors.cyan} />
          <Text style={styles.secondaryButtonText}>BACK</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={approveStep}>
          <CheckCircle2 size={16} color="white" />
          <Text style={styles.primaryButtonText}>
            {activeStep === 'episodesEndings' ? (allApproved ? 'REVALIDATE SETUP' : 'APPROVE SETUP') : 'VALIDATE & CONTINUE'}
          </Text>
          <ChevronRight size={16} color="white" />
        </TouchableOpacity>
      </View>

      <Modal visible={validation !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <AlertTriangle size={18} color={TERMINAL.colors.amber} />
              <Text style={styles.modalTitle}>CANON CONFLICT</Text>
            </View>
            {validation?.blockingConflicts.slice(0, 4).map((issue) => (
              <Text key={issue.id} style={styles.modalIssue}>{issue.message}</Text>
            ))}
            <View style={styles.suggestionBox}>
              {repairLoading ? (
                <View style={styles.suggestionLoading}>
                  <ActivityIndicator color={TERMINAL.colors.amber} />
                  <Text style={styles.suggestionText}>ASKING MODEL FOR A REPAIR...</Text>
                </View>
              ) : (
                <>
                  <Wand2 size={14} color={TERMINAL.colors.cyan} />
                  <Text style={styles.suggestionText}>{repairSuggestion?.summary || 'No repair suggestion available.'}</Text>
                </>
              )}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => { setValidation(null); setRepairSuggestion(null); }}>
                <Text style={styles.secondaryButtonText}>EDIT MANUALLY</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, !repairSuggestion?.proposedPatches.length ? styles.buttonDisabled : null]}
                disabled={!repairSuggestion?.proposedPatches.length}
                onPress={acceptRepairSuggestion}
              >
                <Text style={styles.primaryButtonText}>ACCEPT SUGGESTION</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  stepTabs: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  stepTab: {
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    backgroundColor: TERMINAL.colors.bgLight,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 150,
  },
  stepTabActive: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
  },
  stepTabText: {
    color: TERMINAL.colors.textStrong,
    fontSize: 12,
    fontWeight: '800',
  },
  stepTabTextActive: {
    color: TERMINAL.colors.primary,
  },
  stepTabStatus: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  approvedText: {
    color: TERMINAL.colors.primary,
  },
  warningText: {
    color: TERMINAL.colors.amber,
  },
  warningPanel: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    padding: 10,
  },
  warningPanelText: {
    color: TERMINAL.colors.amber,
    flex: 1,
    fontSize: 12,
  },
  stepBody: {
    maxHeight: 760,
  },
  card: {
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    backgroundColor: TERMINAL.colors.bgLight,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  cardTitle: {
    color: TERMINAL.colors.textStrong,
    fontSize: 13,
    fontWeight: '900',
    flex: 1,
  },
  cardMeta: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
  },
  fieldBlock: {
    marginTop: 8,
  },
  fieldLabel: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    backgroundColor: TERMINAL.colors.bg,
    color: TERMINAL.colors.textStrong,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 38,
    fontSize: 13,
  },
  inputMultiline: {
    minHeight: 86,
    textAlignVertical: 'top',
  },
  selectorWrap: {
    marginTop: 8,
  },
  subTitle: {
    color: TERMINAL.colors.primary,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: TERMINAL.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 42,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 42,
  },
  secondaryButtonText: {
    color: TERMINAL.colors.cyan,
    fontSize: 12,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 680,
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    backgroundColor: TERMINAL.colors.bgLight,
    padding: 18,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    color: TERMINAL.colors.amber,
    fontSize: 15,
    fontWeight: '900',
  },
  modalIssue: {
    color: TERMINAL.colors.textStrong,
    fontSize: 12,
    lineHeight: 18,
  },
  suggestionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.35)',
    backgroundColor: 'rgba(6, 182, 212, 0.08)',
    padding: 10,
  },
  suggestionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suggestionText: {
    color: TERMINAL.colors.cyan,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
  },
});
