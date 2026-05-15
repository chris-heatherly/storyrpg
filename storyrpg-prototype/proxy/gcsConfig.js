function getStoryStorageMode() {
  const raw = process.env.STORY_STORAGE_MODE || 'local';
  return raw === 'gcs' ? 'gcs' : 'local';
}

function getGcsBucketName() {
  return (process.env.GCS_BUCKET_NAME || '').trim();
}

function getGcsStoriesPrefix() {
  return ((process.env.GCS_STORIES_PREFIX || 'stories') + '').replace(/^\/+|\/+$/g, '');
}

function getGcsPublicBaseUrl() {
  const bucket = getGcsBucketName();
  return bucket ? `https://storage.googleapis.com/${bucket}` : '';
}

function mapProxyPathToGcsObjectPath(proxyPath) {
  // proxyPath example: "generated-stories/<runDir>/embedded-media/foo.png"
  const prefix = getGcsStoriesPrefix();
  const normalized = String(proxyPath || '').replace(/^\/+/, '');
  if (!normalized.startsWith('generated-stories/')) return null;
  const rest = normalized.slice('generated-stories/'.length);
  return `${prefix}/${rest}`.replace(/\/+/g, '/');
}

module.exports = {
  getStoryStorageMode,
  getGcsBucketName,
  getGcsStoriesPrefix,
  getGcsPublicBaseUrl,
  mapProxyPathToGcsObjectPath,
};

