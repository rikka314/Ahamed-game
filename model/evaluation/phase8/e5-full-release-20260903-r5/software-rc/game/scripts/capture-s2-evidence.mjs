import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../../docx/plan/game/evidence/s2");
const baseUrl = process.env.AHAMED_GAME_URL ?? "http://127.0.0.1:3020";

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(baseUrl);
  await desktopPage.getByRole("button", { name: "电脑 打开诊所系统" }).waitFor();
  await desktopPage.screenshot({
    path: resolve(outputDirectory, "clinic-graybox-desktop-intro.png"),
    fullPage: true,
  });

  await desktopPage.getByRole("button", { name: "电脑 打开诊所系统" }).click();
  await desktopPage.getByRole("dialog", { name: "诊所电脑" }).getByRole("button", { name: /开始接诊/ }).click();
  await desktopPage.getByRole("button", { name: "叫号 叫下一位患者" }).waitFor();
  await desktopPage.screenshot({
    path: resolve(outputDirectory, "clinic-graybox-desktop-queue.png"),
    fullPage: true,
  });
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 915, height: 412 },
    hasTouch: true,
    isMobile: true,
  });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(baseUrl);
  await mobilePage.getByRole("button", { name: "电脑 打开诊所系统" }).click();
  await mobilePage
    .getByRole("dialog", { name: "诊所电脑" })
    .getByRole("button", { name: /开始接诊/ })
    .click();
  await mobilePage.getByRole("button", { name: "叫号 叫下一位患者" }).waitFor();
  const canvas = mobilePage.getByTestId("game-canvas");
  await canvas.locator("canvas").waitFor();
  await canvas.scrollIntoViewIfNeeded();
  await mobilePage.screenshot({
    path: resolve(outputDirectory, "clinic-graybox-mobile-landscape.png"),
    fullPage: false,
  });
  await mobile.close();
} finally {
  await browser.close();
}
