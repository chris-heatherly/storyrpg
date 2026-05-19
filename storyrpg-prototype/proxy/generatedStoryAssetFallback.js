const fs = require('fs');
const path = require('path');

const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;

function stripGeneratedStoryTimestamp(dirName) {
  return dirName.replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, '');
}

function withTextfixPreference(baseName, ext) {
  return [`${baseName}-textfix1${ext}`, `${baseName}${ext}`];
}

function withBeatRecoveryPreference(baseName, ext) {
  return [
    `${baseName}-recovery-qa-retry-5${ext}`,
    `${baseName}-recovery-qa-retry-4${ext}`,
    `${baseName}-recovery-qa-retry-3${ext}`,
    `${baseName}-recovery-qa-retry-2${ext}`,
    `${baseName}-recovery-textfix1${ext}`,
    `${baseName}-recovery${ext}`,
  ];
}

function buildLegacyEncounterCandidates(fileName) {
  if (!IMAGE_EXT_RE.test(fileName)) return [];

  const ext = path.extname(fileName);
  const stem = fileName.slice(0, -ext.length);

  const storyBeat = stem.match(/^storyboard-v2-story-beat-(episode-\d+-scene-[^-]+-beat-.+)$/);
  if (storyBeat) {
    return withBeatRecoveryPreference(`beat-${storyBeat[1]}`, ext);
  }

  const setup = stem.match(/^storyboard-v2-encounter-setup-(episode-\d+-scene-[^-]+-beat-\d+)$/);
  if (setup) {
    return [`encounter-${setup[1]}-setup-regenerated${ext}`, ...withTextfixPreference(`encounter-${setup[1]}-setup`, ext)];
  }

  const directOutcome = stem.match(
    /^storyboard-v2-encounter-outcome-(episode-\d+-scene-[^-]+-beat-\d+-c\d+)-(success|complicated|failure)$/
  );
  if (directOutcome) {
    return withTextfixPreference(`encounter-${directOutcome[1]}-${directOutcome[2]}`, ext);
  }

  const nestedOutcome = stem.match(
    /^storyboard-v2-encounter-outcome-(episode-\d+-scene-[^-]+-beat-\d+-c\d+)-(success|complicated|failure)-(c\d+-[spf]-c\d+)-(success|complicated|failure)$/
  );
  if (nestedOutcome) {
    return withTextfixPreference(
      `encounter-${nestedOutcome[1]}-path-${nestedOutcome[2]}-path-${nestedOutcome[3]}-${nestedOutcome[4]}`,
      ext
    );
  }

  const situation = stem.match(
    /^storyboard-v2-encounter-situation-(episode-\d+-scene-[^-]+)-beat-(\d+)-c\d+-(success|complicated|failure)-beat-\d+-(c\d+)-(success|complicated|failure)-situation$/
  );
  if (situation) {
    return withTextfixPreference(
      `encounter-${situation[1]}-situation-beat-${situation[2]}-${situation[4]}-${situation[5]}`,
      ext
    );
  }

  const storylet = stem.match(
    /^storyboard-v2-storylet-aftermath-(episode-\d+-scene-[^-]+)-scene-[^-]+-storylet-([a-z-]+)-beat-(\d+)-([A-Za-z]+)$/
  );
  if (storylet) {
    const sceneId = storylet[1].match(/(scene-[^-]+)$/)?.[1] || 'scene';
    return withTextfixPreference(
      `storylet-${storylet[1]}-${storylet[4]}-${sceneId}-storylet-${storylet[2]}-beat-${storylet[3]}`,
      ext
    );
  }

  return [];
}

function getCandidateStoryDirs(storiesDir, storyDirName) {
  const storyRoot = path.join(storiesDir, storyDirName);
  const candidates = [storyRoot];
  const slugBase = stripGeneratedStoryTimestamp(storyDirName);

  let siblings = [];
  try {
    siblings = fs.readdirSync(storiesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== storyDirName && stripGeneratedStoryTimestamp(entry.name) === slugBase)
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return candidates;
  }

  return candidates.concat(siblings.map((name) => path.join(storiesDir, name)));
}

function resolveGeneratedStoryAssetFallback(storiesDir, requestPath) {
  const parts = requestPath.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const storyDirName = parts[0];
  const fileName = parts[parts.length - 1];
  const legacyCandidates = buildLegacyEncounterCandidates(fileName);
  if (legacyCandidates.length === 0) return null;

  for (const storyRoot of getCandidateStoryDirs(storiesDir, storyDirName)) {
    for (const legacyName of legacyCandidates) {
      const candidate = path.join(storyRoot, 'images', legacyName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

module.exports = {
  buildLegacyEncounterCandidates,
  resolveGeneratedStoryAssetFallback,
  stripGeneratedStoryTimestamp,
};
