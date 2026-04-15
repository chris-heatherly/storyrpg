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
 * Check if the current screen has a successfully loaded background image.
 * Story screens should always have a full-bleed background image.
 * Checks both <img> elements AND divs with background-image CSS.
 * An <img> element must have actually loaded (naturalWidth > 0) to count.
 */
async function hasBackgroundImage(page: Page): Promise<{ hasImage: boolean; detail: string }> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Check <img> elements that are large enough and actually loaded
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const rect = img.getBoundingClientRect();
      const isLarge = rect.width > vw * 0.4 && rect.height > vh * 0.3;
      if (isLarge) {
        if (img.naturalWidth > 0 && img.complete) {
          return { hasImage: true, detail: `<img> loaded: ${img.src?.substring(0, 80)}` };
        }
        // Large img element exists but hasn't loaded
        return { hasImage: false, detail: `<img> exists but broken/empty: src="${img.src?.substring(0, 80)}" naturalWidth=${img.naturalWidth} complete=${img.complete}` };
      }
    }

    // Check divs with url() background-image
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const style = window.getComputedStyle(el);
      if (style.backgroundImage && style.backgroundImage.includes('url(')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > vw * 0.4 && rect.height > vh * 0.3) {
          return { hasImage: true, detail: `CSS bg-image: ${style.backgroundImage.substring(0, 80)}` };
        }
      }
    }

    return { hasImage: false, detail: 'No large <img> or background-image found' };
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

  // "CONTINUE STORY" appears on encounter terminal / outcome screens (VICTORY, DEFEATED, etc.)
  if (upper.includes('CONTINUE STORY')) return 'encounter-outcome';

  // Episode recap: "EPISODE RECAP" header or "You chose..." summary
  if (upper.includes('EPISODE RECAP')) return 'episode-recap';

  // Encounter active: clock indicators like "0/6", "PROVE YOUR WORTH", progress fraction
  const hasClocks = /\d+\/\d+/.test(text);
  if (hasClocks && (upper.includes('CLAIM VICTORY') || upper.includes('SEE RESULTS') || upper.includes('CONTINUE'))) {
    return 'encounter';
  }

  // Storylet markers
  const storyletTones = ['AFTERMATH', 'CONSEQUENCES'];
  if (storyletTones.some(t => upper.includes(t))) return 'storylet';

  // Growth summary
  if (upper.includes('GROWTH SUMMARY') || upper.includes('CHARACTER GROWTH')) return 'growth-summary';

  // "You chose" pattern (choice recap shown after a choice)
  if (upper.includes('YOU CHOSE') && upper.includes('CONTINUE')) return 'episode-recap';

  // Home screen
  if (upper.includes('YOUR STORIES') || upper.includes('STORY LIBRARY')) return 'home';

  // Choices: multiple interactive elements (more than just hamburger + CONTINUE)
  const interactiveCount = await page.evaluate(() => {
    const els = document.querySelectorAll('[tabindex="0"]');
    let count = 0;
    for (const el of els) {
      const text = (el.textContent || '').trim();
      if (text !== '☰' && text.length > 0) count++;
    }
    return count;
  });
  if (interactiveCount > 1) return 'choices';

  // Regular beat: CONTINUE visible
  if (upper.includes('CONTINUE')) return 'beat';

  return 'unknown';
}

/**
 * Wait for text animation to complete.
 * StoryRPG uses a typing animation — CONTINUE button only appears after
 * animation finishes. We detect this by waiting for CONTINUE or choice
 * buttons to appear (tabindex="0" elements beyond the hamburger menu).
 */
async function waitForAnimationComplete(page: Page, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await page.evaluate(() => document.body.innerText || '');
    const upper = text.toUpperCase();
    // Check if CONTINUE or CONTINUE STORY appeared, or choice buttons, or episode/home
    if (
      upper.includes('CONTINUE') ||
      upper.includes('CHOOSE EPISODE') ||
      upper.includes('YOUR STORIES') ||
      upper.includes('STORY LIBRARY') ||
      upper.includes('EPISODE RECAP')
    ) {
      return;
    }
    // Also check for interactive elements (choice buttons appear as tabindex="0" divs)
    const interactiveCount = await page.evaluate(() => {
      const els = document.querySelectorAll('[tabindex="0"]');
      let count = 0;
      for (const el of els) {
        const text = (el.textContent || '').trim();
        if (text !== '☰' && text.length > 0) count++;
      }
      return count;
    });
    if (interactiveCount > 0) return;
    await page.waitForTimeout(500);
  }
}

/**
 * Try to click a CONTINUE-like button using Playwright's native click.
 * Native click is essential for React Native Web's touch/responder system.
 */
async function tryClickContinue(page: Page, preferredText?: string): Promise<boolean> {
  const candidates = preferredText
    ? [preferredText, 'CONTINUE STORY', 'CONTINUE']
    : ['CONTINUE STORY', 'CONTINUE'];

  for (const text of candidates) {
    const locator = page.locator(`[tabindex="0"]`).filter({ hasText: new RegExp(`^${text}$`) }).first();
    if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
      await locator.click();
      await page.waitForTimeout(TRANSITION_WAIT);
      return true;
    }
  }

  // Fallback: try text-based locator
  for (const text of candidates) {
    const locator = page.locator(`text=${text}`).first();
    if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
      await locator.click();
      await page.waitForTimeout(TRANSITION_WAIT);
      return true;
    }
  }

  return false;
}

/**
 * Try to click any visible interactive element (not the hamburger menu).
 * Uses Playwright's native click for RN Web compatibility.
 */
async function tryClickAnyButton(page: Page): Promise<boolean> {
  const buttons = page.locator('[tabindex="0"]');
  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    const text = await btn.textContent().catch(() => '');
    if (!text || text.trim() === '☰') continue;

    const box = await btn.boundingBox().catch(() => null);
    if (!box || box.width < 50 || box.height < 20) continue;
    if (box.y < 100) continue; // skip header elements

    await btn.click();
    await page.waitForTimeout(TRANSITION_WAIT);
    return true;
  }

  return false;
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
    console.log('[E2E] Step 2: Selecting story...');
    const bodyText = await getVisibleText(page);
    if (bodyText.toUpperCase().includes('CHOOSE EPISODE')) {
      console.log('[E2E] Already on episode select screen');
    } else {
      // On home screen — find and click a story card
      if (TARGET_STORY) {
        console.log(`[E2E] Looking for story matching: "${TARGET_STORY}"`);
        await clickText(page, TARGET_STORY, { timeout: 15_000 });
      } else {
        const storyCards = page.locator('text=/EPISODES/i').first();
        if (await storyCards.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await storyCards.click();
          await page.waitForTimeout(TRANSITION_WAIT);
        }
      }
      await page.waitForTimeout(2000);
    }

    // ---- Step 3: Select episode ----
    console.log('[E2E] Step 3: Selecting episode...');
    // Wait for "CHOOSE EPISODE" to confirm we're on episode screen
    await page.getByText('CHOOSE EPISODE').waitFor({ state: 'visible', timeout: 10_000 });

    // Click the episode card (the chevron/arrow "›" or the episode title area)
    // Episode cards have the episode number and title. Click the card container.
    const episodeCard = page.locator('text=/01|THE FALL/i').first();
    await episodeCard.waitFor({ state: 'visible', timeout: 10_000 });
    console.log('[E2E] Clicking episode card...');
    await episodeCard.click();

    // Wait for story initialization (INITIALIZING... screen)
    console.log('[E2E] Waiting for story to initialize...');
    await page.waitForTimeout(3000);

    // Wait until we're past the loading screen
    for (let wait = 0; wait < 10; wait++) {
      const screenText = await getVisibleText(page);
      if (!screenText.toUpperCase().includes('INITIALIZING')) break;
      console.log('[E2E] Still initializing...');
      await page.waitForTimeout(1000);
    }

    // Set forced encounter tier if configured
    if (FORCE_TIER) {
      await setForceTier(page, FORCE_TIER);
    }

    // Confirm we entered the reading screen
    const readingScreen = await detectScreen(page);
    console.log(`[E2E] Entered reading flow, detected screen: ${readingScreen}`);
    expect(['beat', 'choices', 'encounter', 'unknown']).toContain(readingScreen);

    // ---- Step 4: Play through the story ----
    let beatCount = 0;
    let screenShotIndex = 0;
    let stuckCount = 0;
    let lastScreenText = '';
    let enteredReading = true;

    while (beatCount < MAX_BEATS) {
      beatCount++;

      // Wait for any text animation to finish before detecting screen state
      await waitForAnimationComplete(page);

      const currentScreen = await detectScreen(page);
      const currentText = (await getVisibleText(page)).substring(0, 200);

      if (beatCount % 5 === 1 || currentScreen !== 'beat') {
        console.log(`[E2E] Beat ${beatCount}: screen=${currentScreen}, text="${currentText.substring(0, 60)}..."`);
      }

      // Stuck detection
      if (currentText === lastScreenText) {
        stuckCount++;
        if (stuckCount > 5) {
          console.log(`[E2E] Stuck after ${beatCount} beats on "${currentScreen}", breaking`);
          await page.screenshot({ path: `test/e2e/screenshots/stuck-${screenShotIndex++}.png` });
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

      // Check for missing background images on screens that should have them
      const shouldHaveImage = ['beat', 'encounter', 'encounter-outcome', 'storylet', 'choices'].includes(currentScreen);
      if (shouldHaveImage) {
        const imgCheck = await hasBackgroundImage(page);
        if (!imgCheck.hasImage) {
          console.log(`[E2E] WARNING: No background image on ${currentScreen} screen at beat ${beatCount}`);
          console.log(`[E2E]   Detail: ${imgCheck.detail}`);
          imageIssues.push({
            screen: `beat-${beatCount} (${currentScreen})`,
            type: 'placeholder',
            detail: `${imgCheck.detail} (${currentScreen} screen)`,
          });
          await page.screenshot({
            path: `test/e2e/screenshots/no-image-${screenShotIndex++}.png`,
          });
        }
      }

      // Handle each screen state
      switch (currentScreen) {
        case 'loading':
          await page.waitForTimeout(2000);
          continue;

        case 'beat': {
          // Click the CONTINUE button — try multiple locator strategies
          const clicked = await tryClickContinue(page);
          if (!clicked) {
            // Fallback: try clicking any touchable
            await tryClickAnyButton(page);
          }
          break;
        }

        case 'choices': {
          console.log(`[E2E] Choices detected at beat ${beatCount}`);
          // Click a choice (not the CONTINUE button — pick an actual choice)
          const buttons = page.locator('[tabindex="0"]');
          const count = await buttons.count();
          let clickedChoice = false;
          for (let i = 0; i < count; i++) {
            const btn = buttons.nth(i);
            const btnText = (await btn.textContent().catch(() => '') || '').trim();
            if (btnText === '☰' || btnText === 'CONTINUE' || btnText === 'CONTINUE STORY') continue;
            const box = await btn.boundingBox().catch(() => null);
            if (!box || box.width < 50) continue;
            console.log(`[E2E]   Picking choice: "${btnText.substring(0, 60)}"`);
            await btn.click();
            await page.waitForTimeout(TRANSITION_WAIT);
            clickedChoice = true;
            break;
          }
          if (!clickedChoice) await tryClickContinue(page);
          break;
        }

        case 'encounter': {
          console.log(`[E2E] Encounter active at beat ${beatCount}`);
          // Try CLAIM VICTORY / SEE RESULTS first, then click a choice
          const claimVictory = await tryClickContinue(page, 'CLAIM VICTORY');
          if (!claimVictory) {
            const seeResults = await tryClickContinue(page, 'SEE RESULTS');
            if (!seeResults) {
              const clicked = await tryClickAnyButton(page);
              if (!clicked) await tryClickContinue(page);
            }
          }
          break;
        }

        case 'encounter-outcome': {
          // Wait a bit for any image opacity animation
          await page.waitForTimeout(2000);

          // Detailed image diagnostics for encounter outcome screens
          const outcomeImageDiag = await page.evaluate(() => {
            const imgs = document.querySelectorAll('img');
            const info: any[] = [];
            for (const img of imgs) {
              const rect = img.getBoundingClientRect();
              // Walk up to check parent opacity
              let el: Element | null = img;
              let effectiveOpacity = 1;
              while (el) {
                const s = window.getComputedStyle(el);
                effectiveOpacity *= parseFloat(s.opacity || '1');
                el = el.parentElement;
              }
              info.push({
                src: (img.src || '').substring(0, 100),
                naturalWidth: img.naturalWidth,
                complete: img.complete,
                w: Math.round(rect.width),
                h: Math.round(rect.height),
                effectiveOpacity: Math.round(effectiveOpacity * 100) / 100,
              });
            }
            return info;
          });
          const outcomeText = await getVisibleText(page);
          const outcomeLabel = outcomeText.toUpperCase().includes('DEFEATED') ? 'DEFEATED'
            : outcomeText.toUpperCase().includes('VICTORY') ? 'VICTORY'
            : outcomeText.toUpperCase().includes('PARTIAL') ? 'PARTIAL VICTORY'
            : 'UNKNOWN';
          console.log(`[E2E] Encounter outcome: ${outcomeLabel}, images: ${JSON.stringify(outcomeImageDiag)}`);

          // Flag if no visible image
          const hasVisibleImg = outcomeImageDiag.some((i: any) => i.naturalWidth > 0 && i.effectiveOpacity > 0.1 && i.w > 100);
          if (!hasVisibleImg) {
            console.log(`[E2E] WARNING: Encounter ${outcomeLabel} screen has no visible image!`);
            imageIssues.push({
              screen: `beat-${beatCount} (encounter-${outcomeLabel.toLowerCase()})`,
              type: 'placeholder',
              detail: `No visible image on encounter ${outcomeLabel} screen`,
            });
          }

          await page.screenshot({
            path: `test/e2e/screenshots/encounter-outcome-${screenShotIndex++}.png`,
          });
          await tryClickContinue(page, 'CONTINUE STORY');
          break;
        }

        case 'growth-summary': {
          await page.screenshot({
            path: `test/e2e/screenshots/growth-${screenShotIndex++}.png`,
          });
          await tryClickContinue(page);
          break;
        }

        case 'storylet': {
          await page.screenshot({
            path: `test/e2e/screenshots/storylet-${screenShotIndex++}.png`,
          });
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
          await tryClickContinue(page);
          break;
        }

        case 'episode-recap': {
          await page.screenshot({
            path: `test/e2e/screenshots/recap-${screenShotIndex++}.png`,
          });
          await tryClickContinue(page);
          break;
        }

        case 'home':
        case 'episodes':
          console.log(`[E2E] Exited to ${currentScreen} screen after ${beatCount} beats — episode complete`);
          await page.screenshot({ path: `test/e2e/screenshots/complete-${screenShotIndex++}.png` });
          beatCount = MAX_BEATS;
          break;

        default: {
          console.log(`[E2E] Unknown screen state at beat ${beatCount}, trying to advance...`);
          // Try CONTINUE STORY, then CONTINUE, then any button
          const clicked = await tryClickContinue(page, 'CONTINUE STORY');
          if (!clicked) {
            const clicked2 = await tryClickContinue(page);
            if (!clicked2) await tryClickAnyButton(page);
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
