import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../../docx/plan/game/evidence/h3");
const baseUrl = process.env.AHAMED_GAME_URL ?? "http://127.0.0.1:3020";
const captures = [];

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
try {
  for (const candidate of ["16", "32"]) {
    await captureCandidate({
      browser,
      candidate,
      label: "desktop",
      viewport: { width: 1440, height: 1000 },
      contextOptions: {},
      fullPage: true,
    });
    await captureCandidate({
      browser,
      candidate,
      label: "mobile-landscape",
      viewport: { width: 915, height: 412 },
      contextOptions: { hasTouch: true, isMobile: true },
      fullPage: false,
    });
  }

  const comparisonPage = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const cards = await Promise.all(
    captures.map(async (capture) => {
      const image = await readFile(resolve(outputDirectory, capture.file));
      return {
        ...capture,
        dataUrl: `data:image/png;base64,${image.toString("base64")}`,
      };
    }),
  );
  await comparisonPage.setContent(`<!doctype html>
    <meta charset="utf-8">
    <title>H3 clinic candidate comparison</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 28px; background: #10231d; color: #edf5e8; font: 16px system-ui, sans-serif; }
      h1 { margin: 0 0 8px; font-size: 25px; }
      p { margin: 0 0 18px; color: #b9cdbd; }
      main { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
      figure { margin: 0; overflow: hidden; border: 1px solid #6f8b78; border-radius: 12px; background: #1a3028; }
      img { display: block; width: 100%; height: 360px; object-fit: contain; background: #081611; image-rendering: pixelated; }
      figcaption { padding: 10px 12px; font-weight: 700; }
      small { display: block; margin-top: 3px; color: #b9cdbd; font-weight: 400; }
    </style>
    <h1>诊所地图与 Tileset H3 · DRAFT 对比</h1>
    <p>同一 ready_to_call 队列状态；自动模拟不替代真实 Android 横屏验收。</p>
    <main>${cards
      .map(
        ({ candidate, device, dataUrl, viewport }) => `<figure>
          <img src="${dataUrl}" alt="H3 ${candidate}px ${device}">
          <figcaption>H3 ${candidate}px · ${device}<small>${viewport.width}×${viewport.height} viewport · contentBuildId dev</small></figcaption>
        </figure>`,
      )
      .join("")}</main>`);
  await comparisonPage.screenshot({
    path: resolve(outputDirectory, "clinic-h3-comparison-2x2.png"),
    fullPage: true,
  });
  await comparisonPage.close();
} finally {
  await browser.close();
}

await writeFile(
  resolve(outputDirectory, "h3-visual-metrics.json"),
  `${JSON.stringify(
    {
      generatedAt: "2026-08-30",
      contentBuildId: "dev",
      status: "DRAFT",
      state: "ready_to_call",
      captures,
      realAndroidLandscapeValidation: "pending",
      staticApproval: "pending",
      inGameApproval: "pending",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

async function captureCandidate({
  browser,
  candidate,
  label,
  viewport,
  contextOptions,
  fullPage,
}) {
  const context = await browser.newContext({ viewport, ...contextOptions });
  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/world-preview?h3Candidate=${candidate}`);
    const candidateLabel = page.getByTestId("h3-candidate");
    await expect(candidateLabel).toHaveText(`H3 候选：${candidate}`);
    await expect(page.getByText("地图：map.clinic.graybox-01")).toBeVisible();
    await page.getByRole("button", { name: "电脑 打开诊所系统" }).click();
    await page
      .getByRole("dialog", { name: "诊所电脑" })
      .getByRole("button", { name: /开始接诊/ })
      .click();
    await page.getByRole("button", { name: "叫号 叫下一位患者" }).waitFor();
    const visiblePatients = page.getByTestId("visible-patient-count");
    await expect(visiblePatients).toHaveText("可见患者：2/2");
    const compositionLabel = page.getByTestId("composition-coverage");
    await expect(compositionLabel).toContainText("locked-zone.future-lower");
    const compositionText = await compositionLabel.textContent();
    const compositionCoverage = compositionText?.replace("构图：", "").split(",") ?? [];
    const requiredCoverage = [
      "anchor.queue.01",
      "anchor.entrance",
      "anchor.patient-seat",
      "locked-zone.future-upper",
      "locked-zone.future-lower",
    ];
    if (!requiredCoverage.every((stableId) => compositionCoverage.includes(stableId))) {
      throw new Error(
        `H3 ${candidate} ${label} composition is missing: ${requiredCoverage
          .filter((stableId) => !compositionCoverage.includes(stableId))
          .join(", ")}`,
      );
    }
    const canvas = page.getByTestId("game-canvas").locator("canvas");
    await canvas.waitFor();
    if (!fullPage) await canvas.scrollIntoViewIfNeeded();
    const file = `clinic-h3-${candidate}-${label}.png`;
    await page.screenshot({ path: resolve(outputDirectory, file), fullPage });
    captures.push({
      candidateId: `h3-${candidate}`,
      candidate,
      device: label,
      viewport,
      logicalViewport: candidate === "16" ? { width: 320, height: 180 } : { width: 640, height: 360 },
      canvasCssBounds: await canvas.boundingBox(),
      file,
      visiblePatients: 2,
      compositionCoverage,
    });
  } finally {
    await context.close();
  }
}
