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
  window.__jumpFrames = [];

  if ("PerformanceObserver" in window) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__layoutShifts.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          sources: entry.sources?.map((source) => {
            const node = source.node;
            return {
              node:
                node?.id ||
                node?.className ||
                node?.tagName ||
                "unknown",
              previous: source.previousRect
                ? {
                    top: Math.round(source.previousRect.top),
                    height: Math.round(source.previousRect.height)
                  }
                : null,
              current: source.currentRect
                ? {
                    top: Math.round(source.currentRect.top),
                    height: Math.round(source.currentRect.height)
                  }
                : null
            };
          })
        });
      }
    });

    observer.observe({ type: "layout-shift", buffered: true });
    window.__layoutShiftObserver = observer;
  }
});

function summarizeFrames(frames, selector) {
  const values = frames
    .map((frame) => frame[selector])
    .filter((rect) => rect && rect.width > 0 && rect.height > 0);

  if (!values.length) {
    return null;
  }

  const heights = values.map((rect) => rect.height);
  const tops = values.map((rect) => rect.top);

  return {
    minTop: Math.min(...tops),
    maxTop: Math.max(...tops),
    topRange: Math.max(...tops) - Math.min(...tops),
    minHeight: Math.min(...heights),
    maxHeight: Math.max(...heights),
    heightRange: Math.max(...heights) - Math.min(...heights)
  };
}

await page.locator("#textInput").fill("hello");

const audit = await page.evaluate(async () => {
  const rectFor = (selector) => {
    const node = document.querySelector(selector);
    if (!node) {
      return null;
    }

    const rect = node.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  };

  const capture = (label) => ({
    label,
    time: Math.round(performance.now()),
    bodyClasses: document.body.className,
    busy: document.querySelector("#resultCard")?.getAttribute("aria-busy"),
    translator: rectFor(".translator-card"),
    result: rectFor("#resultCard"),
    head: rectFor(".result-head"),
    tabs: rectFor("#resultLanguageTabs"),
    translation: rectFor("#translationCard"),
    clearButton: rectFor("#clearButton"),
    translateButton: rectFor("#translateButton")
  });

  const frames = [];
  frames.push(capture("before-click"));
  document.querySelector("#translateButton").click();

  const start = performance.now();
  while (performance.now() - start < 2400) {
    frames.push(capture("frame"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  frames.push(capture("after-2400ms"));
  return {
    frames,
    shifts: window.__layoutShifts || []
  };
});

const visibleFrames = audit.frames.filter((frame) => frame.result?.height > 0);
const busyFrames = visibleFrames.filter((frame) => frame.busy === "true");
const doneFrames = visibleFrames.filter((frame) => frame.busy === "false");

const report = {
  url,
  frameCount: audit.frames.length,
  visibleFrameCount: visibleFrames.length,
  layoutShiftCount: audit.shifts.length,
  layoutShiftScore: Number(
    audit.shifts.reduce((sum, shift) => sum + shift.value, 0).toFixed(6)
  ),
  firstVisible: visibleFrames[0],
  lastVisible: visibleFrames.at(-1),
  wholeVisibleRanges: {
    translator: summarizeFrames(visibleFrames, "translator"),
    result: summarizeFrames(visibleFrames, "result"),
    head: summarizeFrames(visibleFrames, "head"),
    tabs: summarizeFrames(visibleFrames, "tabs"),
    translation: summarizeFrames(visibleFrames, "translation"),
    clearButton: summarizeFrames(visibleFrames, "clearButton"),
    translateButton: summarizeFrames(visibleFrames, "translateButton")
  },
  loadingRanges: {
    result: summarizeFrames(busyFrames, "result"),
    head: summarizeFrames(busyFrames, "head"),
    tabs: summarizeFrames(busyFrames, "tabs"),
    translation: summarizeFrames(busyFrames, "translation")
  },
  doneRanges: {
    result: summarizeFrames(doneFrames, "result"),
    head: summarizeFrames(doneFrames, "head"),
    tabs: summarizeFrames(doneFrames, "tabs"),
    translation: summarizeFrames(doneFrames, "translation")
  },
  layoutShifts: audit.shifts
};

console.log(JSON.stringify(report, null, 2));

await browser.close();
