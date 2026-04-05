import { useCallback } from 'react';
import { SeasonPlannerAgent } from '../../ai-agents/agents/SeasonPlannerAgent';
import { applyEndingModeToAnalysis } from '../../ai-agents/utils/endingResolver';
import { seasonPlanStore } from '../../stores/seasonPlanStore';
import { EndingMode, SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import { SeasonPlan } from '../../types/seasonPlan';
import type { PipelineEvent } from '../../ai-agents/pipeline';

type UseEndingModePlannerArgs = {
  llmProvider: string;
  selectedLlmModel: string;
  selectedLlmApiKey: string;
  sourceAnalysis: SourceMaterialAnalysis | null;
  activeEndingMode?: EndingMode;
  setSourceAnalysis: (analysis: SourceMaterialAnalysis) => void;
  setSeasonPlan: (plan: SeasonPlan | null) => void;
  setIsCreatingSeasonPlan: (value: boolean) => void;
  handleEvent: (event: PipelineEvent) => void;
};

export function useEndingModePlanner({
  llmProvider,
  selectedLlmModel,
  selectedLlmApiKey,
  sourceAnalysis,
  activeEndingMode,
  setSourceAnalysis,
  setSeasonPlan,
  setIsCreatingSeasonPlan,
  handleEvent,
}: UseEndingModePlannerArgs) {
  const refreshSeasonPlanForAnalysis = useCallback(async (updatedAnalysis: SourceMaterialAnalysis) => {
    if (!selectedLlmApiKey) {
      return;
    }

    setIsCreatingSeasonPlan(true);
    try {
      const seasonPlanner = new SeasonPlannerAgent({
        provider: llmProvider as any,
        model: selectedLlmModel,
        apiKey: selectedLlmApiKey,
        maxTokens: 12000,
        temperature: 0.7,
      });
      const result = await seasonPlanner.execute({
        sourceAnalysis: updatedAnalysis,
        preferences: {
          targetScenesPerEpisode: 8,
          targetChoicesPerEpisode: 4,
          pacing: 'moderate',
          endingMode: updatedAnalysis.resolvedEndingMode,
        },
      });

      if (result.success && result.data) {
        setSeasonPlan(result.data);
        await seasonPlanStore.savePlan(result.data, updatedAnalysis);
      } else {
        setSeasonPlan(null);
        handleEvent({
          type: 'warning',
          phase: 'season_planning',
          message: result.error || 'Season planning failed after ending mode update.',
          timestamp: new Date(),
        });
      }
    } finally {
      setIsCreatingSeasonPlan(false);
    }
  }, [handleEvent, llmProvider, selectedLlmApiKey, selectedLlmModel, setIsCreatingSeasonPlan, setSeasonPlan]);

  const handleEndingModeToggle = useCallback(async (mode: EndingMode) => {
    if (!sourceAnalysis || mode === activeEndingMode) return;
    const updatedAnalysis = applyEndingModeToAnalysis(sourceAnalysis, mode);
    setSourceAnalysis(updatedAnalysis);
    setSeasonPlan(null);
    await refreshSeasonPlanForAnalysis(updatedAnalysis);
  }, [activeEndingMode, refreshSeasonPlanForAnalysis, setSeasonPlan, setSourceAnalysis, sourceAnalysis]);

  return {
    refreshSeasonPlanForAnalysis,
    handleEndingModeToggle,
  };
}
