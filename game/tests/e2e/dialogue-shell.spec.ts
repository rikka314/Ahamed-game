import { expect, test, type Page } from "@playwright/test";

const publicCase = {
  publicCaseId: "case.public-dialogue-001",
  caseVersion: "case-v1",
  patientRoleId: "patient-role.public-dialogue-001",
  displayName: "林同学",
  chiefComplaint: "咳嗽两天",
  ageBand: "青年",
  genderDisplay: "女",
};

const alternatePublicCase = {
  publicCaseId: "case.public-dialogue-002",
  caseVersion: "case-v1",
  patientRoleId: "patient-role.public-dialogue-002",
  displayName: "周同学",
  chiefComplaint: "发热一天",
  ageBand: "青年",
  genderDisplay: "男",
};

const activeConsultationKey = "ahamed.clinic.active-consultation.v2";

function consultationPayload(turnCount = 0) {
  return {
    session: {
      contractVersion: "1",
      sessionId: "session.dialogue-001",
      caseId: publicCase.publicCaseId,
      caseVersion: publicCase.caseVersion,
      patientNpcId: "npc.web-consultation-room",
      patientRoleId: publicCase.patientRoleId,
      chiefComplaint: publicCase.chiefComplaint,
      patientDisplay: { displayName: publicCase.displayName },
      allowedActions: ["ask_patient"],
      sessionPhase: "active",
    },
    projection: {
      contractVersion: "1",
      sessionId: "session.dialogue-001",
      caseVersion: publicCase.caseVersion,
      initialPresentation: "医生，我咳嗽两天了。",
      disclosedFacts: turnCount > 0 ? ["fact.duration"] : [],
      completedTests: [],
      turnCount,
      turnLimit: 20,
      sessionPhase: "active",
    },
  };
}

function successfulTurn() {
  return {
    turn: {
      sessionId: "session.dialogue-001",
      turnId: "turn.dialogue-001",
      reply: "两天前开始咳的，晚上会更明显一些。",
      disclosedFactIds: ["fact.duration"],
      effects: [],
      turnNumber: 1,
      sessionPhase: "active",
    },
  };
}

function successfulEvaluation() {
  return {
    contractVersion: "1",
    evaluationId: "evaluation.dialogue-001",
    sessionId: "session.dialogue-001",
    caseVersion: publicCase.caseVersion,
    diagnosis: {
      correct: true,
      matchedConceptId: "concept.public-dialogue-001",
      matchType: "exact",
      explanation: "判断与病例目标一致。",
    },
    scores: {
      diagnosis: 90,
      historyCoverage: 80,
      differentialReasoning: 70,
      testSelection: 80,
      efficiency: 90,
      communication: 100,
      total: 86,
    },
    evidence: [],
    summary: "完成本次虚构病例。",
    completedAt: "2026-09-04T04:00:00.000Z",
    evaluationVersion: "scoring-policy-v1",
  };
}

function successfulSettledTurn() {
  return {
    ...successfulTurn(),
    evaluation: successfulEvaluation(),
  };
}

async function startConsultation(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始问诊" }).click();
  await expect(page.getByLabel("向患者提问")).toBeEnabled({ timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/clinic/cases", async (route) => {
    await route.fulfill({ json: { cases: [publicCase] } });
  });
  await page.route("**/api/clinic/sessions", async (route) => {
    await route.fulfill({ json: consultationPayload() });
  });
  await page.route("**/api/clinic/sessions/session.dialogue-001", async (route) => {
    await route.fulfill({ json: consultationPayload(1) });
  });
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    await route.fulfill({ json: successfulTurn() });
  });
});

test("keeps the consultation chrome-free and renders a patient reply", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("complementary", { name: "病例列表" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "问诊记录" })).toHaveCount(0);
  await expect(page.getByText("剩余回合", { exact: true })).toHaveCount(0);
  await expect(page.getByText("已完成", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "提交判断" })).toHaveCount(0);
  await expect(page.getByText("患者已经候诊，")).toBeVisible();
  await expect(page.getByText("“咳嗽两天”", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "开始问诊" }).click();
  await page.getByLabel("向患者提问").fill("什么时候开始的？");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByText("什么时候开始的？", { exact: true })).toBeVisible();
  await expect(page.getByText("两天前开始咳的，晚上会更明显一些。"))
    .toBeVisible();
});

test("does not submit while a Chinese IME composition is being confirmed", async ({
  page,
}) => {
  let turnRequests = 0;
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    turnRequests += 1;
    await route.fulfill({ json: successfulTurn() });
  });
  await startConsultation(page);
  const composer = page.getByLabel("向患者提问");
  await composer.fill("诊断");

  await composer.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    isComposing: true,
  });

  await expect(composer).toHaveValue("诊断");
  expect(turnRequests).toBe(0);
});

test("automatically settles an explicit diagnosis in a score modal", async ({
  page,
}) => {
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    await route.fulfill({ json: successfulSettledTurn() });
  });
  await startConsultation(page);

  await page.getByLabel("向患者提问").fill("我的最终诊断是上呼吸道感染。");
  await page.getByRole("button", { name: "发送消息" }).click();

  const result = page.getByRole("dialog", { name: "判断准确，做得很好。" });
  await expect(result).toBeVisible();
  await expect(result.getByLabel("综合评分 86 分")).toBeVisible();
  await expect(result.getByText("诊断判断")).toBeVisible();
  await expect(result.getByText("沟通质量")).toBeVisible();
  await expect(result.getByRole("button", { name: "再来一局" })).toBeFocused();
});

test("keeps the composer and score modal inside the portrait mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    await route.fulfill({ json: successfulSettledTurn() });
  });
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("最终诊断是上呼吸道感染。");
  await page.getByRole("button", { name: "发送消息" }).click();

  const result = page.getByRole("dialog");
  await expect(result).toBeVisible();
  await expect(result.getByRole("button", { name: "再来一局" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(412);
});

test("keeps the case pool hidden and immediately assigns a different replay", async ({
  page,
}) => {
  const assignedCaseIds: string[] = [];
  const availableCases = [publicCase, alternatePublicCase];
  await page.unroute("**/api/clinic/cases");
  await page.route("**/api/clinic/cases", async (route) => {
    await route.fulfill({ json: { cases: availableCases } });
  });
  await page.unroute("**/api/clinic/sessions");
  await page.route("**/api/clinic/sessions", async (route) => {
    const body = route.request().postDataJSON() as { publicCaseId: string };
    assignedCaseIds.push(body.publicCaseId);
    const assignedCase = availableCases.find(
      ({ publicCaseId }) => publicCaseId === body.publicCaseId,
    ) ?? publicCase;
    const payload = consultationPayload();
    const sessionId = `session.dialogue-${String(assignedCaseIds.length).padStart(3, "0")}`;
    payload.session.sessionId = sessionId;
    payload.session.caseId = assignedCase.publicCaseId;
    payload.session.caseVersion = assignedCase.caseVersion;
    payload.session.patientRoleId = assignedCase.patientRoleId;
    payload.session.chiefComplaint = assignedCase.chiefComplaint;
    payload.session.patientDisplay.displayName = assignedCase.displayName;
    payload.projection.caseVersion = assignedCase.caseVersion;
    payload.projection.sessionId = sessionId;
    payload.projection.initialPresentation = `医生，我${assignedCase.chiefComplaint}。`;
    await route.fulfill({ json: payload });
  });
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    await route.fulfill({ json: successfulSettledTurn() });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "开始问诊" }).click();
  await expect.poll(() => assignedCaseIds.length).toBe(1);
  await expect(page.getByLabel("向患者提问")).toBeEnabled({ timeout: 15_000 });
  await page.getByLabel("向患者提问").fill("我的最终诊断是测试诊断。");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.getByRole("button", { name: "再来一局" }).click();

  await expect.poll(() => assignedCaseIds.length).toBe(2);
  expect(assignedCaseIds[1]).not.toBe(assignedCaseIds[0]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("向患者提问")).toBeEnabled();
});

test("restores the active consultation after a refresh", async ({ page }) => {
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("什么时候开始的？");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText("两天前开始咳的，晚上会更明显一些。"))
    .toBeVisible();

  await page.reload();

  await expect(page.getByText("什么时候开始的？", { exact: true })).toBeVisible();
  await expect(page.getByText("两天前开始咳的，晚上会更明显一些。"))
    .toBeVisible();
});

test("restores a completed consultation directly into its result modal", async ({
  page,
}) => {
  const completedPayload = consultationPayload(3);
  completedPayload.session.sessionPhase = "completed";
  completedPayload.projection.sessionPhase = "completed";
  await page.unroute("**/api/clinic/sessions/session.dialogue-001");
  await page.route("**/api/clinic/sessions/session.dialogue-001", async (route) => {
    await route.fulfill({ json: completedPayload });
  });
  await page.route("**/api/clinic/sessions/*/diagnosis", async (route) => {
    await route.fulfill({ json: successfulEvaluation() });
  });
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: activeConsultationKey,
      value: {
        version: 2,
        sessionId: "session.dialogue-001",
        messages: [],
      },
    },
  );

  await page.goto("/");

  await expect(page.getByRole("dialog", { name: "判断准确，做得很好。" }))
    .toBeVisible({ timeout: 15_000 });
});

test("keeps the saved consultation when recovery is temporarily unavailable", async ({
  page,
}) => {
  await page.unroute("**/api/clinic/sessions/session.dialogue-001");
  await page.route("**/api/clinic/sessions/session.dialogue-001", async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        code: "MODEL_UNAVAILABLE",
        message: "temporary outage",
        retryable: true,
      },
    });
  });
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: activeConsultationKey,
      value: {
        version: 2,
        sessionId: "session.dialogue-001",
        messages: [{ id: "patient.saved", role: "patient", text: "已保存回答" }],
      },
    },
  );

  await page.goto("/");
  await expect(page.getByText(/存档仍保留/u)).toBeVisible();
  const saved = await page.evaluate((key) => sessionStorage.getItem(key), activeConsultationKey);
  expect(saved).toContain("已保存回答");
});

test("reuses the same turn id when the transport result is unknown", async ({
  page,
}) => {
  const clientTurnIds: string[] = [];
  let attempts = 0;
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    const body = route.request().postDataJSON() as { clientTurnId: string };
    clientTurnIds.push(body.clientTurnId);
    attempts += 1;
    if (attempts === 1) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ json: successfulTurn() });
  });
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("什么时候开始的？");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(/问诊服务暂时不可用/u)).toBeVisible();

  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByText("两天前开始咳的，晚上会更明显一些。"))
    .toBeVisible();
  expect(clientTurnIds).toHaveLength(2);
  expect(clientTurnIds[1]).toBe(clientTurnIds[0]);
});

test("reuses the same create id after an unknown result and refresh", async ({
  page,
}) => {
  const clientRequestIds: string[] = [];
  let attempts = 0;
  await page.unroute("**/api/clinic/sessions");
  await page.route("**/api/clinic/sessions", async (route) => {
    const body = route.request().postDataJSON() as { clientRequestId: string };
    clientRequestIds.push(body.clientRequestId);
    attempts += 1;
    if (attempts === 1) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ json: consultationPayload() });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "开始问诊" }).click();
  await expect(page.getByText(/问诊服务暂时不可用/u)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "开始问诊" }).click();

  await expect(page.getByLabel("向患者提问")).toBeEnabled({ timeout: 10_000 });
  expect(clientRequestIds).toHaveLength(2);
  expect(clientRequestIds[1]).toBe(clientRequestIds[0]);
});

test("uses a new turn id after a confirmed model failure", async ({ page }) => {
  const clientTurnIds: string[] = [];
  let attempts = 0;
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    const body = route.request().postDataJSON() as { clientTurnId: string };
    clientTurnIds.push(body.clientTurnId);
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { code: "MODEL_TIMEOUT", message: "模型超时", retryable: true },
      });
      return;
    }
    await route.fulfill({ json: successfulTurn() });
  });
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("什么时候开始的？");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(/本轮等待超时/u)).toBeVisible();

  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByText("两天前开始咳的，晚上会更明显一些。"))
    .toBeVisible();
  expect(clientTurnIds).toHaveLength(2);
  expect(clientTurnIds[1]).not.toBe(clientTurnIds[0]);
});

test("restores a pending turn and confirms it with the original id", async ({
  page,
}) => {
  const originalTurnId = "web.turn.pending-refresh-001";
  const submittedIds: string[] = [];
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    const body = route.request().postDataJSON() as { clientTurnId: string };
    submittedIds.push(body.clientTurnId);
    await route.fulfill({ json: successfulTurn() });
  });
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: activeConsultationKey,
      value: {
        version: 2,
        sessionId: "session.dialogue-001",
        messages: [],
        pendingTurn: {
          sessionId: "session.dialogue-001",
          clientTurnId: originalTurnId,
          text: "什么时候开始的？",
          doctorMessage: {
            id: "doctor.pending",
            role: "doctor",
            label: "你的提问",
            text: "什么时候开始的？",
          },
        },
      },
    },
  );

  await page.goto("/");
  await expect(page.getByText(/结果尚未确认/u)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByText("两天前开始咳的，晚上会更明显一些。"))
    .toBeVisible();
  expect(submittedIds).toEqual([originalTurnId]);
});

test("reuses the same turn id when automatic evaluation is unavailable", async ({
  page,
}) => {
  const clientTurnIds: string[] = [];
  const clientControlledAttempts: unknown[] = [];
  let attempts = 0;
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown> & {
      clientTurnId: string;
    };
    clientTurnIds.push(body.clientTurnId);
    clientControlledAttempts.push(body["evaluationAttempt"]);
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: {
          code: "EVALUATION_UNAVAILABLE",
          message: "评估暂时不可用",
          retryable: true,
        },
      });
      return;
    }
    await route.fulfill({ json: successfulSettledTurn() });
  });
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("我的最终诊断是上呼吸道感染。");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(/评分服务暂时不可用/u)).toBeVisible();

  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByRole("dialog", { name: "判断准确，做得很好。" }))
    .toBeVisible();
  expect(clientTurnIds).toHaveLength(2);
  expect(clientTurnIds[1]).toBe(clientTurnIds[0]);
  expect(clientControlledAttempts).toEqual([undefined, undefined]);
});

test("returns to a new-case entry when automatic evaluation is exhausted", async ({
  page,
}) => {
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        code: "EVALUATION_UNAVAILABLE",
        message: "retry limit reached",
        retryable: false,
      },
    });
  });
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("最终诊断是上呼吸道感染。");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByText(/本局未能结算/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始问诊" })).toBeEnabled();
  await expect(page.getByLabel("向患者提问")).toBeDisabled();
});

test("recovers a completed evaluation when the first HTTP result is lost", async ({
  page,
}) => {
  const submittedBodies: Array<{
    clientTurnId: string;
  }> = [];
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    submittedBodies.push(route.request().postDataJSON());
    if (submittedBodies.length === 1) {
      await route.fulfill({
        status: 502,
        json: {
          code: "INTERNAL_ERROR",
          message: "response lost after commit",
          retryable: true,
        },
      });
      return;
    }
    await route.fulfill({ json: { evaluation: successfulEvaluation() } });
  });
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("最终诊断是上呼吸道感染。");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(/response lost after commit/u)).toBeVisible();

  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  expect(submittedBodies).toHaveLength(2);
  expect(submittedBodies[1]?.clientTurnId).toBe(submittedBodies[0]?.clientTurnId);
});

test("unlocks a new case when the active session has expired", async ({ page }) => {
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    await route.fulfill({
      status: 410,
      json: {
        code: "SESSION_EXPIRED",
        message: "本次问诊已过期，请重新开始病例。",
        retryable: false,
      },
    });
  });
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("什么时候开始的？");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByText("本次问诊已过期，请重新开始病例。")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始问诊" })).toBeEnabled();
});

test("locks the composer while a patient turn is pending", async ({ page }) => {
  let releaseTurn: (() => void) | undefined;
  await page.unroute("**/api/clinic/sessions/*/turns");
  await page.route("**/api/clinic/sessions/*/turns", async (route) => {
    await new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    await route.fulfill({ json: successfulTurn() });
  });
  await startConsultation(page);
  await page.getByLabel("向患者提问").fill("什么时候开始的？");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByLabel("向患者提问")).toBeDisabled();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  releaseTurn?.();
  await expect(page.getByText("两天前开始咳的，晚上会更明显一些。"))
    .toBeVisible();
});
