/**
 * Checkpoint Review Component
 *
 * UI for reviewing AI-generated content at human checkpoints.
 * Allows approval, rejection, or editing of generated content.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
} from 'react-native';
import { TERMINAL, createBoxTop, createBoxBottom, createDivider } from '../theme/terminal';

export interface CheckpointData {
  phase: string;
  data: unknown;
  timestamp: Date;
  requiresApproval: boolean;
}

interface CheckpointReviewProps {
  checkpoint: CheckpointData;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onEdit?: (editedData: unknown) => void;
}

export const CheckpointReview: React.FC<CheckpointReviewProps> = ({
  checkpoint,
  onApprove,
  onReject,
  onEdit,
}) => {
  const [showRawData, setShowRawData] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const renderPhaseIcon = () => {
    switch (checkpoint.phase) {
      case 'World Bible':
        return '🌍';
      case 'Character Bible':
        return '👥';
      case 'Visual Bible':
        return '📸';
      case 'Episode Blueprint':
        return '📋';
      case 'Scene Content':
        return '📝';
      case 'QA Report':
        return '✅';
      default:
        return '📦';
    }
  };

  const renderDataPreview = () => {
    const data = checkpoint.data as any;

    switch (checkpoint.phase) {
      case 'World Bible':
        return <WorldBiblePreview data={data} />;
      case 'Character Bible':
        return <CharacterBiblePreview data={data} />;
      case 'Visual Bible':
        return <VisualBiblePreview data={data} />;
      case 'Episode Blueprint':
        return <BlueprintPreview data={data} />;
      case 'Scene Content':
        return <SceneContentPreview data={data} />;
      case 'QA Report':
        return <QAReportPreview data={data} />;
      default:
        return <GenericPreview data={data} />;
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {createBoxTop(50)}
        </Text>
        <Text style={styles.headerText}>
          │ {renderPhaseIcon()} CHECKPOINT: {checkpoint.phase.toUpperCase()}
        </Text>
        <Text style={styles.headerText}>
          │ {checkpoint.timestamp.toLocaleTimeString()}
        </Text>
        <Text style={styles.headerText}>
          {createDivider(50)}
        </Text>
      </View>

      {/* Content Preview */}
      <ScrollView style={styles.content}>
        {renderDataPreview()}

        {/* Raw Data Toggle */}
        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => setShowRawData(!showRawData)}
        >
          <Text style={styles.toggleText}>
            {TERMINAL.symbols.arrow} {showRawData ? 'Hide' : 'Show'} Raw Data
          </Text>
        </TouchableOpacity>

        {showRawData && (
          <View style={styles.rawDataBox}>
            <Text style={styles.rawDataText}>
              {JSON.stringify(checkpoint.data, null, 2)}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Reject Reason Input */}
      {showRejectInput && (
        <View style={styles.rejectInputContainer}>
          <Text style={styles.labelText}>Rejection Reason:</Text>
          <TextInput
            style={styles.rejectInput}
            value={rejectReason}
            onChangeText={setRejectReason}
            placeholder="Enter reason for rejection..."
            placeholderTextColor={TERMINAL.colors.muted}
            multiline
          />
        </View>
      )}

      {/* Action Buttons */}
      {checkpoint.requiresApproval && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.approveButton]}
            onPress={onApprove}
          >
            <Text style={styles.buttonText}>
              {TERMINAL.symbols.check} APPROVE
            </Text>
          </TouchableOpacity>

          {!showRejectInput ? (
            <TouchableOpacity
              style={[styles.button, styles.rejectButton]}
              onPress={() => setShowRejectInput(true)}
            >
              <Text style={styles.buttonText}>
                {TERMINAL.symbols.cross} REJECT
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.rejectButton]}
              onPress={() => {
                onReject(rejectReason);
                setShowRejectInput(false);
                setRejectReason('');
              }}
            >
              <Text style={styles.buttonText}>
                CONFIRM REJECT
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Footer */}
      <Text style={styles.footerText}>
        {createBoxBottom(50)}
      </Text>
    </View>
  );
};

// Preview Components for different data types

const WorldBiblePreview: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const locations = (data.locations as Array<{ name: string; overview: string }>) || [];
  const factions = (data.factions as Array<{ name: string; overview: string }>) || [];
  const worldRules = (data.worldRules as string[]) || [];

  return (
    <View>
      <Text style={styles.sectionTitle}>WORLD RULES</Text>
      {worldRules.slice(0, 3).map((rule, i) => (
        <Text key={i} style={styles.listItem}>• {rule}</Text>
      ))}
      {worldRules.length > 3 && (
        <Text style={styles.moreText}>...and {worldRules.length - 3} more</Text>
      )}

      <Text style={styles.sectionTitle}>LOCATIONS ({locations.length})</Text>
      {locations.slice(0, 3).map((loc, i) => (
        <View key={i} style={styles.itemBox}>
          <Text style={styles.itemTitle}>{loc.name}</Text>
          <Text style={styles.itemDesc}>{loc.overview}</Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>FACTIONS ({factions.length})</Text>
      {factions.slice(0, 2).map((fac, i) => (
        <View key={i} style={styles.itemBox}>
          <Text style={styles.itemTitle}>{fac.name}</Text>
          <Text style={styles.itemDesc}>{fac.overview}</Text>
        </View>
      ))}
    </View>
  );
};

const CharacterBiblePreview: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const characters = (data.characters as Array<{
    name: string;
    overview: string;
    want: string;
    fear: string;
    flaw: string;
  }>) || [];

  return (
    <View>
      <Text style={styles.sectionTitle}>CHARACTERS ({characters.length})</Text>
      {characters.map((char, i) => (
        <View key={i} style={styles.itemBox}>
          <Text style={styles.itemTitle}>{char.name}</Text>
          <Text style={styles.itemDesc}>{char.overview}</Text>
          <Text style={styles.statsText}>
            Want: {char.want?.slice(0, 50)}...
          </Text>
          <Text style={styles.statsText}>
            Fear: {char.fear?.slice(0, 50)}...
          </Text>
          <Text style={styles.statsText}>
            Flaw: {char.flaw?.slice(0, 50)}...
          </Text>
        </View>
      ))}
    </View>
  );
};

const VisualBiblePreview: React.FC<{ data: any[] }> = ({ data }) => {
  return (
    <View>
      <Text style={styles.sectionTitle}>VISUAL BIBLE (MASTER REFERENCES)</Text>
      <View style={styles.imageGrid}>
        {data.map((item, i) => (
          <View key={i} style={styles.imageItem}>
            <Image 
              source={{ uri: item.imageUrl }} 
              style={styles.thumbnail}
              resizeMode="cover"
            />
            <Text style={styles.imageLabel}>{item.id}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const BlueprintPreview: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const scenes = (data.scenes as Array<{
    name: string;
    purpose: string;
    choicePoint?: { type: string };
  }>) || [];
  const arc = data.arc as { hook: string; climax: string } | undefined;

  return (
    <View>
      {arc && (
        <>
          <Text style={styles.sectionTitle}>NARRATIVE ARC</Text>
          <Text style={styles.listItem}>Hook: {arc.hook}</Text>
          <Text style={styles.listItem}>Climax: {arc.climax}</Text>
        </>
      )}

      <Text style={styles.sectionTitle}>SCENE GRAPH ({scenes.length} scenes)</Text>
      {scenes.map((scene, i) => (
        <View key={i} style={styles.sceneItem}>
          <Text style={styles.sceneNumber}>{i + 1}.</Text>
          <View style={styles.sceneInfo}>
            <Text style={styles.itemTitle}>{scene.name}</Text>
            <Text style={styles.purposeTag}>
              [{scene.purpose}]
              {scene.choicePoint && ` [${scene.choicePoint.type} choice]`}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
};

const SceneContentPreview: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const sceneContents = (data.sceneContents as Array<{
    sceneName: string;
    beats: Array<{ text: string; speaker?: string }>;
  }>) || [];

  return (
    <View>
      <Text style={styles.sectionTitle}>SCENE CONTENT</Text>
      {sceneContents.map((scene, i) => (
        <View key={i} style={styles.itemBox}>
          <Text style={styles.itemTitle}>{scene.sceneName}</Text>
          <Text style={styles.statsText}>{scene.beats?.length || 0} beats</Text>
          {scene.beats?.[0] && (
            <Text style={styles.previewText}>
              "{scene.beats[0].text.slice(0, 100)}..."
            </Text>
          )}
        </View>
      ))}
    </View>
  );
};

const QAReportPreview: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const overallScore = data.overallScore as number || 0;
  const passesQA = data.passesQA as boolean || false;
  const criticalIssues = (data.criticalIssues as string[]) || [];
  const summary = data.summary as string || '';

  return (
    <View>
      <Text style={styles.sectionTitle}>QA RESULTS</Text>

      <View style={[styles.scoreBox, passesQA ? styles.passBox : styles.failBox]}>
        <Text style={styles.scoreText}>
          Score: {overallScore}/100 {passesQA ? '✓ PASSED' : '✗ NEEDS WORK'}
        </Text>
      </View>

      {criticalIssues.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>CRITICAL ISSUES</Text>
          {criticalIssues.map((issue, i) => (
            <Text key={i} style={styles.errorItem}>• {issue}</Text>
          ))}
        </>
      )}

      <Text style={styles.sectionTitle}>SUMMARY</Text>
      <Text style={styles.summaryText}>{summary}</Text>
    </View>
  );
};

const GenericPreview: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const keys = Object.keys(data).slice(0, 5);

  return (
    <View>
      <Text style={styles.sectionTitle}>DATA KEYS</Text>
      {keys.map((key, i) => (
        <Text key={i} style={styles.listItem}>• {key}</Text>
      ))}
      {Object.keys(data).length > 5 && (
        <Text style={styles.moreText}>...and {Object.keys(data).length - 5} more</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: TERMINAL.colors.bg,
    padding: 16,
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    margin: 8,
  },
  header: {
    marginBottom: 16,
  },
  headerText: {
    color: TERMINAL.colors.cyan,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 14,
  },
  content: {
    maxHeight: 400,
  },
  sectionTitle: {
    color: TERMINAL.colors.amber,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 14,
    marginTop: 16,
    marginBottom: 8,
  },
  listItem: {
    color: TERMINAL.colors.primary,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 12,
    marginLeft: 8,
    marginBottom: 4,
  },
  moreText: {
    color: TERMINAL.colors.muted,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 11,
    marginLeft: 8,
    fontStyle: 'italic',
  },
  itemBox: {
    backgroundColor: TERMINAL.colors.bgLight,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: TERMINAL.colors.primaryDim,
  },
  itemTitle: {
    color: TERMINAL.colors.primaryBright,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 13,
    fontWeight: 'bold',
  },
  itemDesc: {
    color: TERMINAL.colors.primary,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 11,
    marginTop: 4,
  },
  statsText: {
    color: TERMINAL.colors.muted,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 10,
    marginTop: 4,
  },
  previewText: {
    color: TERMINAL.colors.primaryDim,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
  },
  sceneItem: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  sceneNumber: {
    color: TERMINAL.colors.cyan,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 12,
    width: 24,
  },
  sceneInfo: {
    flex: 1,
  },
  purposeTag: {
    color: TERMINAL.colors.amberDim,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 10,
  },
  scoreBox: {
    padding: 12,
    marginVertical: 8,
    borderWidth: 1,
  },
  passBox: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(51, 255, 51, 0.1)',
  },
  failBox: {
    borderColor: TERMINAL.colors.error,
    backgroundColor: 'rgba(255, 51, 51, 0.1)',
  },
  scoreText: {
    color: TERMINAL.colors.primaryBright,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 16,
    textAlign: 'center',
  },
  errorItem: {
    color: TERMINAL.colors.error,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 12,
    marginLeft: 8,
  },
  summaryText: {
    color: TERMINAL.colors.primary,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 11,
    lineHeight: 18,
  },
  toggleButton: {
    marginTop: 16,
    paddingVertical: 8,
  },
  toggleText: {
    color: TERMINAL.colors.cyanDim,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 12,
  },
  rawDataBox: {
    backgroundColor: TERMINAL.colors.bgHighlight,
    padding: 12,
    marginTop: 8,
    maxHeight: 200,
  },
  rawDataText: {
    color: TERMINAL.colors.muted,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 9,
  },
  rejectInputContainer: {
    marginTop: 16,
  },
  labelText: {
    color: TERMINAL.colors.amber,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 12,
    marginBottom: 8,
  },
  rejectInput: {
    backgroundColor: TERMINAL.colors.bgLight,
    borderWidth: 1,
    borderColor: TERMINAL.colors.error,
    color: TERMINAL.colors.primary,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 12,
    padding: 12,
    minHeight: 60,
  },
  actions: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  approveButton: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(51, 255, 51, 0.1)',
  },
  rejectButton: {
    borderColor: TERMINAL.colors.error,
    backgroundColor: 'rgba(255, 51, 51, 0.1)',
  },
  buttonText: {
    color: TERMINAL.colors.primaryBright,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 14,
    fontWeight: 'bold',
  },
  footerText: {
    color: TERMINAL.colors.border,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 14,
    marginTop: 16,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  imageItem: {
    width: '47%',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: TERMINAL.colors.primaryDim,
    padding: 4,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 9 / 19.5,
    backgroundColor: TERMINAL.colors.bgDark,
  },
  imageLabel: {
    color: TERMINAL.colors.cyan,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
});

export default CheckpointReview;
