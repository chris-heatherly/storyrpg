import { describe, it } from 'vitest';
import story from '../generated-stories/bite-me-redux_2026-05-20T00-25-57/08-final-story.json';
import { transformStoryToGraph } from '../src/visualizer/storyGraphTransformer';
import { enrichStoryGraphWithChoiceSystems } from '../src/visualizer/choiceSystemAnalyzer';
import { expandStoryGraphResidue } from '../src/visualizer/residueGraphExpander';
import { layoutGraph } from '../src/visualizer/layoutEngine';

describe('inspect redux', () => {
  it('prints graph focus candidates', () => {
    const raw = transformStoryToGraph(story as any);
    const graph = layoutGraph(expandStoryGraphResidue(story as any, enrichStoryGraphWithChoiceSystems(story as any, raw)));
    const beats = graph.nodes.filter((node) => node.type === 'beat');
    const opening = [...beats].sort((a, b) => {
      const episodeCompare = String(a.episodeId || '').localeCompare(String(b.episodeId || ''));
      if (episodeCompare !== 0) return episodeCompare;
      const sceneCompare = String(a.sceneId || '').localeCompare(String(b.sceneId || ''));
      if (sceneCompare !== 0) return sceneCompare;
      return (a.beatNumber ?? Number.MAX_SAFE_INTEGER) - (b.beatNumber ?? Number.MAX_SAFE_INTEGER);
    })[0];
    console.log('story episodes', (story as any).episodes.map((ep: any) => ({ id: ep.id, n: ep.number, start: ep.startingSceneId, scenes: ep.scenes.map((s: any) => s.id) })));
    console.log('sceneGroups', Array.from(graph.sceneGroups.entries()).map(([sceneId, ids]) => ({ sceneId, count: ids.length, episodes: Array.from(new Set(ids.map((id) => graph.nodes.find((n) => n.id === id)?.episodeId))) })));
    console.log('top nodes', graph.nodes.slice().sort((a,b)=>a.y-b.y || a.x-b.x).slice(0,12).map((n)=>({ id:n.id,type:n.type, label:n.label, sceneId:n.sceneId, episodeId:n.episodeId, beatNumber:n.beatNumber, y:n.y, text:n.fullText?.slice(0,60) })));
    console.log('opening heuristic', { id: opening?.id, label: opening?.label, sceneId: opening?.sceneId, episodeId: opening?.episodeId, beatNumber: opening?.beatNumber, y: opening?.y, text: opening?.fullText?.slice(0,100) });
  });
});
