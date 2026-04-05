vi.mock('expo-file-system', () => ({
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  makeDirectoryAsync: vi.fn(async () => undefined),
  writeAsStringAsync: vi.fn(async () => undefined),
  readAsStringAsync: vi.fn(async () => ''),
}));

import { VideoGenerationService } from './videoGenerationService';

describe('VideoGenerationService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts inline videos from snake_case Veo responses', async () => {
    const service = new VideoGenerationService({ enabled: true, maxConcurrent: 1 });

    const result = await (service as any).extractVideoFromResult({
      response: {
        generated_videos: [
          {
            video: {
              bytesBase64Encoded: 'Zm9v',
              mimeType: 'video/mp4',
            },
          },
        ],
      },
    }, 'test-key');

    expect(result).toEqual({
      base64: 'Zm9v',
      mimeType: 'video/mp4',
    });
  });

  it('downloads uri-based Veo outputs when inline bytes are absent', async () => {
    const service = new VideoGenerationService({ enabled: true, maxConcurrent: 1 });
    const fetchMock = vi.fn(async () => new Response('video-bytes', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await (service as any).extractVideoFromResult({
      response: {
        generatedVideos: [
          {
            video: {
              uri: 'https://generativelanguage.googleapis.com/v1beta/files/video-123?alt=media',
            },
          },
        ],
      },
    }, 'test-key');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/files/video-123?alt=media&key=test-key',
    );
    expect(result).toEqual({
      base64: 'dmlkZW8tYnl0ZXM=',
      mimeType: 'video/mp4',
    });
  });
});
