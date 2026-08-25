import { expect, test } from "@playwright/test";

test("boots the client-only Phaser world", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "诊所运行时 PoC" })).toBeVisible();
  const canvas = page.getByTestId("game-canvas").locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCount(1);
  await expect(page.getByText("诊所已加载")).toBeAttached();
});

test("moves with the keyboard and opens an interaction", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "webkit" || testInfo.project.name === "mobile-chromium",
    "Desktop keyboard behavior is covered by Chromium and Firefox.",
  );

  await page.goto("/");
  await expect(page.getByTestId("game-canvas").locator("canvas")).toBeVisible();

  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(4_000);
  await page.keyboard.up("ArrowRight");
  const interactionButton = page.getByRole("button", { name: "交互：候诊患者" });
  await expect(interactionButton).toBeVisible();

  await interactionButton.click();
  await expect(page.getByRole("dialog", { name: "候诊患者" })).toBeVisible();
  await page.getByRole("button", { name: "返回诊所" }).click();
  await expect(page.getByRole("dialog", { name: "候诊患者" })).toBeHidden();
});

test("moves with the touch control", async ({ page, browserName }, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium" || browserName !== "chromium",
    "Touch hold is covered by the mobile Chromium project.",
  );

  await page.goto("/");
  await expect(page.getByTestId("game-canvas").locator("canvas")).toBeVisible();

  const rightButton = page.getByRole("button", { name: "向右移动" });
  const box = await rightButton.boundingBox();
  expect(box).not.toBeNull();

  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const client = await page.context().newCDPSession(page);

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await page.waitForTimeout(3_500);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await expect(page.getByRole("button", { name: "交互：候诊患者" })).toBeVisible();
});
