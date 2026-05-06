import { chromium } from "playwright";

const url = "https://translation-pwa.qhzggzh-linguago.workers.dev";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector("#textInput");

await page.evaluate(() => {
  window.__layoutShifts = [];
  if ("PerformanceObserver" in window) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__layoutShifts.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput
        });
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
    window.__layoutShiftObserver = observer;
  }
});

function rectSummary(rect) {
  if (!rect) return null;
  return {
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

async function motionSnapshot(label) {
  return page.evaluate((name) => {
    const tabs = document.querySelector("#resultLanguageTabs");
    const tabBefore = tabs ? getComputedStyle(tabs, "::before") : null;
    const result = document.querySelector("#resultCard")?.getBoundingClientRect();
    const translation = document.querySelector("#translationCard")?.getBoundingClientRect();
    const activeTab = document.querySelector(".result-tab.active");
    const transitionOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
        animationName: style.animationName,
        filter: style.filter
      };
    };

    return {
      label: name,
      activeTab: activeTab?.textContent?.trim() || "",
      activeIndex: tabs?.dataset.activeIndex || "",
      indicatorTransform: tabBefore?.transform || "",
      result: result
        ? {
            top: Math.round(result.top),
            width: Math.round(result.width),
            height: Math.round(result.height)
          }
        : null,
      translation: translation
        ? {
            top: Math.round(translation.top),
            width: Math.round(translation.width),
            height: Math.round(translation.height)
          }
        : null,
      transitions: {
        tab: transitionOf(".result-tab"),
        tabs: transitionOf("#resultLanguageTabs"),
        translateButton: transitionOf("#translateButton"),
        clearButton: transitionOf("#clearButton"),
        settingsButton: transitionOf("#settingsButton"),
        historyItem: transitionOf(".history-item"),
        select: transitionOf("#providerSelect")
      }
    };
  }, label);
}

await page.locator("#textInput").fill("hello");
await page.locator("#translateButton").tap();
await page.waitForSelector("#resultCard:not([aria-busy='true'])", { timeout: 30000 });
await page.waitForTimeout(250);
await page.evaluate(() => {
  window.__layoutShifts = [];
});

const before = await motionSnapshot("before-tab");
await page.locator(".result-tab[data-lang='pt-BR']").tap();
const afterClick = await motionSnapshot("after-click");
await page.waitForTimeout(90);
const mid = await motionSnapshot("mid-transition");
await page.waitForTimeout(260);
const after = await motionSnapshot("after-transition");

const shifts = await page.evaluate(() => window.__layoutShifts || []);

const report = {
  url,
  before,
  afterClick,
  mid,
  after,
  changedIndicator:
    before.indicatorTransform !== after.indicatorTransform ||
    before.activeIndex !== after.activeIndex,
  midTransitionDifferent:
    mid.indicatorTransform !== before.indicatorTransform &&
    mid.indicatorTransform !== after.indicatorTransform,
  resultHeightDelta: after.result.height - before.result.height,
  translationHeightDelta: after.translation.height - before.translation.height,
  layoutShiftCount: shifts.length,
  layoutShiftScore: Number(shifts.reduce((sum, shift) => sum + shift.value, 0).toFixed(6)),
  shifts
};

console.log(JSON.stringify(report, null, 2));

await browser.close();
