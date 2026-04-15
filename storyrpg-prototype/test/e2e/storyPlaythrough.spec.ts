/**
 * Tier 2: Headless Browser Playthrough QA
 *
 * Plays through a generated story in-browser, verifying that images load
 * and screens render correctly at every step.
 *
 * Usage:
 *   npm run test:e2e                              # run all E2E tests
 *   npm run test:e2e -- --grep "Blade Runner"     # filter by story title
 *
 * Prerequisites:
 *   - Proxy running on port 3001 (`npm run proxy`)
 *   - Expo web running on port 8081 (`npm run web`)
 *   OR use `npm run dev` to start both
 *
 * Environment variables:
 *   E2E_BASE_URL       Override app URL (default http://localhost:8081)
 *   E2E_STORY          Story title substring to select (default: first story)
 *   E2E_MAX_BEATS      Max beats to play through per scene (default: 100)
 *   E2E_ENCOUNTER_TIER Force encounter tier: success|complicated|failure
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_BEATS = parseInt(process.env.E2E_MAX_BEATS || '100', 10);
const TARGET_STORY = process.env.E2E_STORY || '';
const FORCE_TIER = process.env.E2E_ENCOUNTER_TIER || '';
const TRANSITION_WAIT = 1200; // ms to wait after clicking for animations

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ImageIssue {
  screen: string;
  type: 'broken' | 'placeholder' | 'console-error';
  detail: string;
}

async function waitForApp(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  // Wait for React to mount
  await page.waitForTimeout(2000);
}

async function clickText(page: Page, text: string | RegExp, options?: { timeout?: number }) {
  const timeout = options?.timeout ?? 10_000;
  const el = page.getByText(text, { exact: false }).first();
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
  await page.waitForTimeout(TRANSITION_WAIT);
}

async function getVisibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText || '');
}

/**
 * Check every <img> element on the page for broken images.
 * Returns list of broken image URLs.
 */
async function checkImagesOnScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const broken: string[] = [];
    const images = document.querySelectorAll('img');
    for (const img of images) {
      if (img.src && img.naturalWidth === 0 && img.complete) {
        broken.push(img.src);
      }
    }
    return broken;
  });
}

/**
 * Detect current screen state from visible text content.
 */
type ScreenState =
  | 'home'
  | 'episodes'
  | 'loading'
  | 'beat'
  | 'choices'
  | 'encounter'
  | 'encounter-outcome'
  | 'growth-summary'
  | 'storylet'
  | 'episode-recap'
  | 'unknown';

async function detectScreen(page: Page): Promise<ScreenState> {
  const text = await getVisibleText(page);
  const upper = text.toUpperCase();

  if (upper.includes('CHOOSE EPISODE')) return 'episodes';
  if (upper.includes('INITIALIZING')) return 'loading';
  if (upper.includes('EPISODE RECAP') || upper.includes('YOU CHOSE')) return 'episode-recap';
  if (upper.includes('VICTORY') && upper.includes('CONTINUE STORY')) return 'encounter-outcome';
  if (upper.includes('DEFEATED') && upper.includes('CONTINUE STORY')) return 'encounter-outcome';
  if (upper.includes('ESCAPED') && upper.includes('CONTINUE STORY')) return 'encounter-outcome';
  if (upper.includes('PARTIAL VICTORY') && upper.includes('CONTINUE STORY')) return 'encounter-outcome';
  if (upper.includes('AFTERMATH') || upper.includes('CONSEQUENCES') || upper.includes('DEFEAT') || upper.includes('ESCAPE')) {
    if (await page.getByText('CONTINUE').first().isVisible().catch(() => false)) {
      const hasStoryletMarker = upper.includes('AFTERMATH') || upper.includes('CONSEQUENCES') || upper.includes('DEFEAT') || upper.includes('ESCAPE');
      if (hasStoryletMarker && !upper.includes('CONTINUE STORY')) return 'storylet';
    }
  }
  if (upper.includes('GROWTH') || (upper.includes('CONTINUE') && upper.includes('RELATIONSHIP'))) return 'growth-summary';

  // Check for encounter (multiple choice buttons with skill-like labels)
  const choiceCount = await page.locator('[accessibilityRole="button"]').count();
  const hasContinue = await page.getByText('CONTINUE').first().isVisible().catch(() => false);
  const hasContinueStory = await page.getByText('CONTINUE STORY').first().isVisible().catch(() => false);

  if (hasContinueStory) return 'encounter-outcome';
  if (hasContinue && choiceCount <= 2) return 'beat';

  // Story selection home screen
  const hasStoryCards = upper.includes('EPISODES');
  if (hasStoryCards && !upper.includes('CHOOSE EPISODE') && upper.includes('PLAY')) return 'home';

  if (hasContinue) return 'beat';

  return 'unknown';
}

/**
 * Inject __QA_FORCE_TIER into the page window to control encounter outcomes.
 */
async function setForceTier(page: Page, tier: string) {
  if (tier) {
    await page.evaluate((t) => {
      (window as any).__QA_FORCE_TIER = t;
    }, tier);
  }
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

test.describe('Story Playthrough QA', () => {
  let imageIssues: ImageIssue[] = [];
  let consoleErrors: string[] = [];
  let networkFailures: string[] = [];

  test('Full story playthrough with image verification', async ({ page }) => {
    imageIssues = [];
    consoleErrors = [];
    networkFailures = [];

    // Collect console errors related to images
    page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      if (msg.type() === 'error' || msg.type() === 'warning') {
        if (
          text.includes('image') ||
          text.includes('Image') ||
          text.includes('placeholder') ||
          text.includes('FAILED') ||
          text.includes('coverage gap')
        ) {
          consoleErrors.push(text);
        }
      }
    });

    // Monitor network for image 404s
    page.on('response', (response) => {
      const url = response.url();
      if (
        (url.includes('/generated-stories/') || url.includes('/images/')) &&
        response.status() >= 400
      ) {
        networkFailures.push(`${response.status()} ${url}`);
      }
    });

    // ---- Step 1: Navigate to app ----
    await page.goto('/');
    await waitForApp(page);

    // ---- Step 2: Select story ----
    const bodyText = await getVisibleText(page);
    if (bodyText.toUpperCase().includes('CHOOSE EPISODE')) {
      // Already on episode select (story was pre-loaded)
    } else {
      // On home screen — find and click a story card
      if (TARGET_STORY) {
        await clickText(page, TARGET_STORY, { timeout: 15_000 });
      } else {
        // Click first story card's play area
        const storyCards = page.locator('text=/EPISODES/i').first();
        if (await storyCards.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await storyCards.click();
          await page.waitForTimeout(TRANSITION_WAIT);
        }
      }
    }

    // ---- Step 3: Select episode ----
    const screen = await detectScreen(page);
    if (screen === 'episodes') {
      // Click first episode
      const episodeCard = page.locator('text=/THE FALL|EPISODE|01/i').first();
      await episodeCard.waitFor({ state: 'visible', timeout: 10_000 });
      await episodeCard.click();
      await page.waitForTimeout(3000); // Wait for story initialization
    }

    // Set forced encounter tier if configured
    if (FORCE_TIER) {
      await setForceTier(page, FORCE_TIER);
    }

    // ---- Step 4: Play through the story ----
    let beatCount = 0;
    let screenShotIndex = 0;
    let stuckCount = 0;
    let lastScreenText = '';

    while (beatCount < MAX_BEATS) {
      beatCount++;

      const currentScreen = await detectScreen(page);
      const currentText = (await getVisibleText(page)).substring(0, 200);

      // Stuck detection
      if (currentText === lastScreenText) {
        stuckCount++;
        if (stuckCount > 5) {
          console.log(`[E2E] Stuck after ${beatCount} beats, breaking`);
          break;
        }
      } else {
        stuckCount = 0;
      }
      lastScreenText = currentText;

      // Image verification at every screen
      const brokenImages = await checkImagesOnScreen(page);
      if (brokenImages.length > 0) {
        for (const url of brokenImages) {
          imageIssues.push({
            screen: `beat-${beatCount} (${currentScreen})`,
            type: 'broken',
            detail: url,
          });
        }
        await page.screenshot({
          path: `test/e2e/screenshots/broken-${screenShotIndex++}.png`,
        });
      }

      // Handle each screen state
      switch (currentScreen) {
        case 'loading':
          await page.waitForTimeout(2000);
          continue;

        case 'beat': {
          const continueBtn = page.getByText('CONTINUE', { exact: true }).first();
          if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await continueBtn.click();
            await page.waitForTimeout(TRANSITION_WAIT);
          } else {
            // Might be a choice screen
            const choiceBtns = page.locator('[accessibilityRole="button"]');
            const count = await choiceBtns.count();
            if (count > 0) {
              await choiceBtns.first().click();
              await page.waitForTimeout(TRANSITION_WAIT);
            }
          }
          break;
        }

        case 'choices': {
          const choiceBtns = page.locator('[accessibilityRole="button"]');
          const count = await choiceBtns.count();
          if (count > 0) {
            // Pick first available choice
            await choiceBtns.first().click();
            await page.waitForTimeout(TRANSITION_WAIT);
          }
          break;
        }

        case 'encounter': {
          // In encounter — click first visible choice or continue
          const encounterChoices = page.locator('[accessibilityRole="button"]');
          const count = await encounterChoices.count();
          if (count > 0) {
            await encounterChoices.first().click();
            await page.waitForTimeout(TRANSITION_WAIT);
          } else {
            const contBtn = page.getByText(/CONTINUE/i).first();
            if (await contBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await contBtn.click();
              await page.waitForTimeout(TRANSITION_WAIT);
            }
          }
          break;
        }

        case 'encounter-outcome': {
          // Take screenshot of the outcome screen (key QA moment)
          await page.screenshot({
            path: `test/e2e/screenshots/encounter-outcome-${screenShotIndex++}.png`,
          });

          const contStoryBtn = page.getByText('CONTINUE STORY').first();
          if (await contStoryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await contStoryBtn.click();
            await page.waitForTimeout(TRANSITION_WAIT);
          } else {
            const contBtn = page.getByText('CONTINUE').first();
            await contBtn.click();
            await page.waitForTimeout(TRANSITION_WAIT);
          }
          break;
        }

        case 'growth-summary': {
          await page.screenshot({
            path: `test/e2e/screenshots/growth-${screenShotIndex++}.png`,
          });
          await clickText(page, 'CONTINUE');
          break;
        }

        case 'storylet': {
          await page.screenshot({
            path: `test/e2e/screenshots/storylet-${screenShotIndex++}.png`,
          });
          // Check storylet image specifically
          const brokenStorylet = await checkImagesOnScreen(page);
          if (brokenStorylet.length > 0) {
            for (const url of brokenStorylet) {
              imageIssues.push({
                screen: `storylet-beat-${beatCount}`,
                type: 'broken',
                detail: url,
              });
            }
          }
          await clickText(page, 'CONTINUE');
          break;
        }

        case 'episode-recap': {
          await page.screenshot({
            path: `test/e2e/screenshots/recap-${screenShotIndex++}.png`,
          });
          // Episode complete — done with this episode
          const contBtn = page.getByText('CONTINUE').first();
          if (await contBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await contBtn.click();
            await page.waitForTimeout(TRANSITION_WAIT);
          }
          break;
        }

        case 'home':
        case 'episodes':
          // We've exited the story — done
          console.log(`[E2E] Returned to ${currentScreen} after ${beatCount} beats`);
          beatCount = MAX_BEATS; // break out
          break;

        default: {
          // Unknown state — try clicking CONTINUE or any visible button
          const anyBtn = page.getByText(/CONTINUE/i).first();
          if (await anyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await anyBtn.click();
            await page.waitForTimeout(TRANSITION_WAIT);
          } else {
            await page.waitForTimeout(1000);
          }
          break;
        }
      }
    }

    // ---- Step 5: Report ----
    console.log(`[E2E] Playthrough complete: ${beatCount} screens visited`);
    console.log(`[E2E] Image issues: ${imageIssues.length}`);
    console.log(`[E2E] Console image errors: ${consoleErrors.length}`);
    console.log(`[E2E] Network failures: ${networkFailures.length}`);

    if (imageIssues.length > 0) {
      console.log('[E2E] Broken images:');
      for (const issue of imageIssues) {
        console.log(`  [${issue.screen}] ${issue.type}: ${issue.detail}`);
      }
    }

    if (consoleErrors.length > 0) {
      console.log('[E2E] Console image warnings/errors:');
      for (const err of consoleErrors) {
        console.log(`  ${err}`);
      }
    }

    if (networkFailures.length > 0) {
      console.log('[E2E] Network failures:');
      for (const fail of networkFailures) {
        console.log(`  ${fail}`);
      }
    }

    // Assertions
    expect(imageIssues, 'No broken images should be found during playthrough').toHaveLength(0);
    expect(networkFailures, 'No image network failures (404, 500, etc.)').toHaveLength(0);
  });
});
