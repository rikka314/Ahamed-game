import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

async function readPlayerPosition(page: Page): Promise<{ x: number; y: number }> {
  const text = await page.getByTestId("player-position").textContent();
  const match = text?.match(/位置：(-?\d+), (-?\d+)/);
  if (!match) throw new Error(`Could not read player position from: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

test("boots the Tiled clinic through the client-only Phaser boundary", async ({ page }) => {
  await page.goto("/world-preview");

  await expect(page.getByRole("heading", { name: "今天，诊所开始接诊" })).toBeVisible();
  const canvas = page.getByTestId("game-canvas").locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCount(1);
  await expect(page.getByText("诊所已加载")).toBeAttached();
  await expect(page.getByText("又是开始接诊的一天")).toBeVisible();
  await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeVisible();
  await expect(page.getByText("地图：map.clinic.graybox-01")).toBeVisible();
  await expect(page.getByTestId("h3-candidate")).toHaveText("H3 候选：default");
});

for (const candidate of ["16", "32"] as const) {
  test(`boots the native H3 ${candidate}px tilemap and preserves the queue composition`, async (
    { page },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name === "webkit",
      "The H3 comparison matrix covers Chromium, Firefox, and mobile Chromium.",
    );

    await page.goto(`/world-preview?h3Candidate=${candidate}`);
    await expect(page.getByTestId("game-canvas").locator("canvas")).toBeVisible();
    await expect(page.getByText("地图：map.clinic.graybox-01")).toBeVisible();
    await expect(page.getByTestId("h3-candidate")).toHaveText(`H3 候选：${candidate}`);
    await expect(page.getByText("contentBuildId：dev")).toBeVisible();
    await expect(page.getByTestId("render-contract")).toHaveText(
      /前景=100;\s*玩家=60;\s*碰撞=11/,
    );
    await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeVisible();

    await page.getByRole("button", { name: "电脑 打开诊所系统" }).click();
    await page
      .getByRole("dialog", { name: "诊所电脑" })
      .getByRole("button", { name: /开始接诊/ })
      .click();
    await expect(page.getByRole("button", { name: "叫号 叫下一位患者" })).toBeVisible();
    await expect(page.getByTestId("visible-patient-count")).toHaveText("可见患者：2/2");

    if (testInfo.project.name === "mobile-chromium") {
      const canvas = page.getByTestId("game-canvas").locator("canvas");
      await canvas.scrollIntoViewIfNeeded();
      const canvasBox = await canvas.boundingBox();
      const viewport = page.viewportSize();
      expect(canvasBox).not.toBeNull();
      expect(viewport).not.toBeNull();
      expect(canvasBox!.y).toBeGreaterThanOrEqual(0);
      expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(viewport!.height);
      await expect(page.getByTestId("composition-coverage")).toHaveText(
        /anchor\.queue\.01,anchor\.entrance,anchor\.patient-seat,locked-zone\.future-upper,locked-zone\.future-lower/,
      );
    }
  });
}

test("falls back safely when an H3 map resource fails", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The resource-failure path runs once in Chromium.");

  await page.route("**/h3-16/maps/clinic-community.tmj", (route) => route.abort("failed"));
  await page.goto("/world-preview?h3Candidate=16");

  await expect(page.getByText("地图：map.clinic.fallback-dev")).toBeVisible();
  await expect(page.getByTestId("h3-candidate")).toHaveText("H3 候选：16");
  await expect(page.getByText(/地图加载失败.*开发回退场景/)).toBeVisible();
  await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeVisible();
});

test("rejects a self-consistent 32px map deployed to the 16px candidate path", async (
  { page },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "chromium", "The mixed-deployment path runs once in Chromium.");

  const wrongMapPath = resolve(
    process.cwd(),
    "public/game-assets/dev/h3-32/maps/clinic-community.tmj",
  );
  await page.route("**/h3-16/maps/clinic-community.tmj", (route) =>
    route.fulfill({ path: wrongMapPath, contentType: "application/json" }),
  );
  await page.goto("/world-preview?h3Candidate=16");

  await expect(page.getByText("地图：map.clinic.fallback-dev")).toBeVisible();
  await expect(page.getByText(/does not match the requested candidate density/)).toBeVisible();
});

for (const candidate of ["16", "32"] as const) {
  test(`enforces the H3 ${candidate}px right-side equipment collision`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Candidate collision runs once in Chromium.");

    await page.goto(`/world-preview?h3Candidate=${candidate}`);
    await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeVisible();
    const scale = Number(candidate) / 16;
    const before = await readPlayerPosition(page);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(1_600);
    await page.keyboard.up("ArrowRight");
    const atWall = await readPlayerPosition(page);
    expect(atWall.x).toBeGreaterThan(before.x);
    expect(atWall.x).toBeGreaterThanOrEqual(280 * scale);
    expect(atWall.x).toBeLessThan(320 * scale);

    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowRight");
    const stillAtWall = await readPlayerPosition(page);
    expect(Math.abs(stillAtWall.x - atWall.x)).toBeLessThanOrEqual(1);
  });
}

test("moves with the desktop keyboard after the intro", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "webkit" || testInfo.project.name === "mobile-chromium",
    "Desktop keyboard behavior is covered by Chromium and Firefox.",
  );

  await page.goto("/world-preview");
  await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeVisible();
  const position = page.getByTestId("player-position");
  const before = await position.textContent();

  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowLeft");

  await expect(position).not.toHaveText(before ?? "");
});

test("opens the clinic and cycles through two patients", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The full S2 graybox loop runs once in Chromium.");

  await page.goto("/world-preview");
  await page.getByRole("button", { name: "电脑 打开诊所系统" }).click();
  const computer = page.getByRole("dialog", { name: "诊所电脑" });
  await expect(computer).toBeVisible();
  await expect(computer.getByRole("button", { name: /开始接诊/ })).toBeEnabled();
  await expect(computer.getByRole("button", { name: /商店/ })).toBeDisabled();
  await expect(computer.getByRole("button", { name: /升级/ })).toBeDisabled();

  await computer.getByRole("button", { name: /开始接诊/ }).click();
  const callNext = page.getByRole("button", { name: "叫号 叫下一位患者" });
  await expect(callNext).toBeVisible();
  await callNext.click();
  await expect(page.getByText("患者正在进门", { exact: true })).toBeVisible();
  await expect(page.getByText("患者已落座", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("current-patient-pose")).toHaveText("当前患者姿态：seated");
  await expect(page.getByText("您好，医生。我已经准备好开始今天的问诊了。")).toBeVisible();

  await page.getByRole("button", { name: "灰盒验证 完成本例并测试患者离场" }).click();
  await expect(callNext).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("已完成 1", { exact: true })).toBeVisible();

  await callNext.click();
  await expect(page.getByText("患者已落座", { exact: true })).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "灰盒验证 完成本例并测试患者离场" }).click();
  await expect(page.getByText("本日队列完成", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("已完成 2", { exact: true })).toBeVisible();
});

test("isolates world input while the computer panel is open", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The modal input boundary runs once in Chromium.");

  await page.goto("/world-preview");
  const position = page.getByTestId("player-position");
  await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeVisible();
  await page.getByRole("button", { name: "电脑 打开诊所系统" }).click();
  await expect(page.getByRole("dialog", { name: "诊所电脑" })).toBeVisible();
  const before = await position.textContent();

  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowLeft");
  await expect(position).toHaveText(before ?? "");

  const computer = page.getByRole("dialog", { name: "诊所电脑" });
  await page.getByRole("button", { name: "关闭诊所电脑" }).click();
  await expect(computer).toBeHidden();
  await page.waitForTimeout(100);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowLeft");
  await expect(position).not.toHaveText(before ?? "");
});

test("reopens the computer after closing it before the shift", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The pre-shift reopen regression runs once in Chromium.");

  await page.goto("/world-preview");
  const openComputer = page.getByRole("button", { name: "电脑 打开诊所系统" });
  await expect(openComputer).toBeVisible();
  await openComputer.click();
  const computer = page.getByRole("dialog", { name: "诊所电脑" });
  await expect(computer).toBeVisible();
  await page.getByRole("button", { name: "关闭诊所电脑" }).click();
  await expect(computer).toBeHidden();

  await openComputer.click();
  await expect(computer).toBeVisible();
  await expect(computer.getByRole("button", { name: /开始接诊/ })).toBeEnabled();
});

test("moves with touch controls in mobile landscape", async ({ page, browserName }, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium" || browserName !== "chromium",
    "Touch hold is covered by the mobile Chromium project.",
  );

  await page.goto("/world-preview");
  await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeVisible();
  await page.getByRole("button", { name: "电脑 打开诊所系统" }).click();
  await page.getByRole("dialog", { name: "诊所电脑" }).getByRole("button", { name: /开始接诊/ }).click();
  await expect(page.getByRole("button", { name: "叫号 叫下一位患者" })).toBeVisible();
  await expect(page.getByTestId("visible-patient-count")).toHaveText("可见患者：2/2");
  const position = page.getByTestId("player-position");
  const before = await position.textContent();
  const downButton = page.getByRole("button", { name: "向下移动" });
  const canvas = page.getByTestId("game-canvas").locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  const box = await downButton.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(canvasBox!.y).toBeGreaterThanOrEqual(0);
  expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(viewport!.height);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, id: 1 }],
  });
  await page.waitForTimeout(420);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect(position).not.toHaveText(before ?? "");
});

test("pauses coarse-pointer devices in portrait and resumes in landscape", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Orientation gate is a mobile-only contract.");

  await page.goto("/world-preview");
  await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeVisible();
  const position = page.getByTestId("player-position");
  const before = await position.textContent();
  await page.setViewportSize({ width: 412, height: 915 });
  const orientationGate = page.getByRole("dialog", { name: "请将设备旋转为横屏" });
  await expect(orientationGate).toBeVisible();
  await expect(page.getByText("诊所暂停", { exact: true })).toBeVisible();
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowLeft");
  await expect(position).toHaveText(before ?? "");

  await page.setViewportSize({ width: 915, height: 412 });
  await expect(orientationGate).toBeHidden();
  await expect(page.getByRole("button", { name: "电脑 打开诊所系统" })).toBeEnabled();
  await page.waitForTimeout(100);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowLeft");
  await expect(position).not.toHaveText(before ?? "");
});
