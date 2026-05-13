import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createStoryCatalog } = require('../../proxy/storyCatalog') as {
  createStoryCatalog: (storiesDir: string, port: number) => {
    listLatestStoryRecords: () => Array<{
      pkg: {
        story: {
          episodes: Array<{ number: number; title: string }>;
        };
      };
    }>;
  };
};

function writeStory(
  dir: string,
  storyId: string,
  title: string,
  episodes: Array<{ number: number; title: string }>,
  mtime: Date,
) {
  fs.mkdirSync(dir, { recursive: true });
  const story = {
    id: storyId,
    title,
    genre: 'test',
    synopsis: 'Test story',
    coverImage: '',
    initialState: {
      attributes: {},
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes: episodes.map((episode) => ({
      id: `ep${episode.number}`,
      number: episode.number,
      title: episode.title,
      synopsis: episode.title,
      coverImage: '',
      scenes: [],
      startingSceneId: '',
    })),
  };
  const file = path.join(dir, 'story.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 3, story }, null, 2));
  fs.utimesSync(file, mtime, mtime);
}

describe('storyCatalog continuation records', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-catalog-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('normalizes offset numbers in the newest multi-episode package', () => {
    writeStory(
      path.join(tmpDir, 'bite-me-old'),
      'bite-me',
      'Bite Me',
      [{ number: 1, title: 'Old Episode' }],
      new Date('2026-05-10T00:00:00Z'),
    );
    writeStory(
      path.join(tmpDir, 'bite-me-new'),
      'bite-me',
      'Bite Me',
      [
        { number: 2, title: 'The Rules of the Game' },
        { number: 3, title: 'Field Notes on the Undead' },
      ],
      new Date('2026-05-11T00:00:00Z'),
    );

    const catalog = createStoryCatalog(tmpDir, 3001);
    const [record] = catalog.listLatestStoryRecords();

    expect(record.pkg.story.episodes.map((episode) => episode.number)).toEqual([1, 2]);
    expect(record.pkg.story.episodes.map((episode) => episode.title)).toEqual([
      'The Rules of the Game',
      'Field Notes on the Undead',
    ]);
  });

  it('merges earlier episodes when the newest package is a single continuation episode', () => {
    writeStory(
      path.join(tmpDir, 'wedding-ep1'),
      'wedding',
      'Wedding',
      [{ number: 1, title: 'Grounds for Myth' }],
      new Date('2026-05-10T00:00:00Z'),
    );
    writeStory(
      path.join(tmpDir, 'wedding-ep2'),
      'wedding',
      'Wedding',
      [{ number: 2, title: 'Signs and Wonders' }],
      new Date('2026-05-11T00:00:00Z'),
    );

    const catalog = createStoryCatalog(tmpDir, 3001);
    const [record] = catalog.listLatestStoryRecords();

    expect(record.pkg.story.episodes.map((episode) => episode.number)).toEqual([1, 2]);
    expect(record.pkg.story.episodes.map((episode) => episode.title)).toEqual([
      'Grounds for Myth',
      'Signs and Wonders',
    ]);
  });
});
