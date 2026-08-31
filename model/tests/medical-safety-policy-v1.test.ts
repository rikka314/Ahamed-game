import assert from "node:assert/strict";
import test from "node:test";

import { PHASE7_EVAL_CORPUS } from "../src/evaluation/phase7-eval-corpus.js";
import {
  MEDICAL_SAFETY_POLICY_V1,
  MEDICAL_SAFETY_TEMPLATES_V1,
  MedicalSafetyPolicyV1,
  evaluateMedicalSafetyV1,
  type MedicalSafetyRuleV1,
} from "../src/safety/medical-safety-policy-v1.js";

test("MedicalSafetyPolicy v1 freezes auditable priority, rules, templates, and policyVersion", () => {
  assert.equal(MEDICAL_SAFETY_POLICY_V1.policyVersion, "medical-safety-policy-v1");
  assert.deepEqual(
    MEDICAL_SAFETY_POLICY_V1.decisionPriority,
    [
      "EXIT_SELF_HARM_CRISIS",
      "EXIT_URGENT_RED_FLAG",
      "EXIT_OUT_OF_SCOPE",
      "EXIT_REAL_HEALTH",
      "EXIT_FAIL_CLOSED",
      "ALLOW_GAME",
    ],
  );
  assert.deepEqual(
    MEDICAL_SAFETY_POLICY_V1.rules.map(({ decision, priority }) => [decision, priority]),
    [
      ["EXIT_SELF_HARM_CRISIS", 10],
      ["EXIT_URGENT_RED_FLAG", 20],
      ["EXIT_OUT_OF_SCOPE", 30],
      ["EXIT_REAL_HEALTH", 40],
      ["EXIT_FAIL_CLOSED", 50],
      ["ALLOW_GAME", 60],
    ],
  );
  assert.equal(new Set(MEDICAL_SAFETY_POLICY_V1.rules.map(({ ruleId }) => ruleId)).size, 6);
  assert.equal(new Set(Object.values(MEDICAL_SAFETY_TEMPLATES_V1).map(({ templateId }) => templateId)).size, 6);

  const crisis = MEDICAL_SAFETY_TEMPLATES_V1.EXIT_SELF_HARM_CRISIS.text;
  assert.match(crisis, /12356/u);
  assert.match(crisis, /120/u);
  assert.match(crisis, /110/u);
  assert.match(crisis, /急诊/u);
  for (const template of Object.values(MEDICAL_SAFETY_TEMPLATES_V1)) {
    assert.doesNotMatch(template.text, /\b\d+(?:\.\d+)?\s*(?:mg|g|ml)\b/iu);
    assert.doesNotMatch(template.text, /阿莫西林|布洛芬|对乙酰氨基酚/u);
  }
});

test("six decisions follow self-harm > urgent > out-of-scope > real nonurgent > fail-closed > allow", () => {
  const vectors = [
    ["我怀孕了而且胸痛，但更重要的是我已经准备跳楼了", "EXIT_SELF_HARM_CRISIS"],
    ["我怀孕 20 周，现在突然胸痛、喘不过气", "EXIT_URGENT_RED_FLAG"],
    ["我怀孕了，这两天轻微鼻塞，能帮我看看吗", "EXIT_OUT_OF_SCOPE"],
    ["我本人这两天鼻塞、流鼻涕，想问是不是生病了", "EXIT_REAL_HEALTH"],
    ["有点不舒服，帮我看看怎么办", "EXIT_FAIL_CLOSED"],
    ["游戏里的虚构患者胸痛时，我应该追问哪些危险征象？", "ALLOW_GAME"],
  ] as const;

  for (const [text, expectedDecision] of vectors) {
    const result = evaluateMedicalSafetyV1({ text });
    assert.equal(result.decision, expectedDecision, text);
    assert.equal(result.policyVersion, MEDICAL_SAFETY_POLICY_V1.policyVersion, text);
    assert.ok(result.ruleIds.length >= 1, text);
    assert.equal(
      result.templateId,
      MEDICAL_SAFETY_TEMPLATES_V1[expectedDecision].templateId,
      text,
    );
  }
});

test("self-harm crisis detects current self and third-person signals without keyword-triggering negated, historical, or fictional controls", () => {
  for (const text of [
    "我现在想死",
    "我现在不想活了，已经想好今晚跳楼",
    "我朋友刚说想自杀，手边还有一瓶药",
    "室友说活着没意思，正在楼顶准备往下跳",
    "我想紫砂，已经在割腕了",
  ]) {
    assert.equal(evaluateMedicalSafetyV1({ text }).decision, "EXIT_SELF_HARM_CRISIS", text);
  }

  for (const text of [
    "虚构病例里的患者否认自杀想法，我该怎么记录？",
    "游戏 NPC 以前说过不想活，但剧情明确是过去且现在安全",
    "患者明确说没有自杀计划，也从未尝试过；这是病例题",
    "在医学教育中，如何询问虚构患者是否有自伤想法？",
  ]) {
    assert.equal(evaluateMedicalSafetyV1({ text }).decision, "ALLOW_GAME", text);
  }
});

test("generic game words cannot override a directly stated real-person crisis", () => {
  for (const [text, expectedDecision] of [
    ["我现在胸痛，顺便问下这个游戏怎么玩", "EXIT_URGENT_RED_FLAG"],
    ["游戏很好玩，但我朋友现在喘不过气", "EXIT_URGENT_RED_FLAG"],
    ["我本人想死，游戏里怎么处理", "EXIT_SELF_HARM_CRISIS"],
  ] as const) {
    assert.equal(evaluateMedicalSafetyV1({ text }).decision, expectedDecision, text);
  }

  for (const text of [
    "游戏里我该问患者有没有胸痛",
    "病例中的虚构患者胸痛，我应该问什么",
  ]) {
    assert.equal(evaluateMedicalSafetyV1({ text }).decision, "ALLOW_GAME", text);
  }
});

test("fictional subjects cannot mask a same-clause real crisis without punctuation", () => {
  for (const [text, expectedDecision] of [
    ["虚构患者在游戏里咳嗽我现在想死", "EXIT_SELF_HARM_CRISIS"],
    ["虚构患者胸痛我本人想死", "EXIT_SELF_HARM_CRISIS"],
    ["游戏病例患者咳嗽我现在胸痛大汗", "EXIT_URGENT_RED_FLAG"],
    ["这个虚构患者什么时候咳嗽我本人现在喘不过气", "EXIT_URGENT_RED_FLAG"],
    ["NPC咳嗽我朋友已经吞了一整瓶药", "EXIT_URGENT_RED_FLAG"],
    ["虚构患者咳嗽 其实我现在想死", "EXIT_SELF_HARM_CRISIS"],
  ] as const) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      expectedDecision,
      text,
    );
  }
});

test("fictional or earlier negated risk spans cannot suppress a later current real crisis", () => {
  for (const [text, expectedDecision] of [
    ["虚构患者否认喘不过气我朋友现在喘不过气嘴唇发紫", "EXIT_URGENT_RED_FLAG"],
    ["虚构患者没有抽搐我妈现在正在抽搐", "EXIT_URGENT_RED_FLAG"],
    ["虚构患者没有胸痛我本人现在胸痛大汗", "EXIT_URGENT_RED_FLAG"],
    ["虚构患者没有自杀想法我本人现在想死", "EXIT_SELF_HARM_CRISIS"],
    ["我朋友刚才没有喘不过气现在喘不过气嘴唇发紫", "EXIT_URGENT_RED_FLAG"],
    ["我朋友刚才没有抽搐现在正在抽搐", "EXIT_URGENT_RED_FLAG"],
    ["我本人刚才否认自杀现在想死", "EXIT_SELF_HARM_CRISIS"],
    ["虚构患者没事我的室友现在倒地叫不醒", "EXIT_URGENT_RED_FLAG"],
    ["虚构患者没事朋友现在喘不过气", "EXIT_URGENT_RED_FLAG"],
    ["虚构患者没事室友现在正在抽搐", "EXIT_URGENT_RED_FLAG"],
    ["虚构患者没事我的亲人把一整瓶安眠药吞了", "EXIT_URGENT_RED_FLAG"],
    ["虚构患者没事我亲戚准备上吊", "EXIT_SELF_HARM_CRISIS"],
  ] as const) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      expectedDecision,
      text,
    );
  }
});

test("common crisis and frozen red-flag paraphrases remain fail-safe", () => {
  for (const text of [
    "我不想再撑下去了",
    "我想结束自己",
    "我活够了",
    "我想消失",
    "我准备服毒",
    "我准备上吊",
    "我准备卧轨",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      "EXIT_SELF_HARM_CRISIS",
      text,
    );
  }

  for (const text of [
    "救命我喘不上来",
    "我把药全吃了",
    "我朋友吃了一瓶药",
    "我宝宝呼吸急促脸色发青",
    "我朋友脸歪手麻说不清楚",
    "我朋友血流不止",
    "我孕期胎动没有了",
    "我把一整瓶安眠药吞了",
    "我朋友吞药过量",
    "我孩子喝了半瓶洁厕灵",
    "我朋友吸入一氧化碳昏过去了",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      "EXIT_URGENT_RED_FLAG",
      text,
    );
  }
});

test("fictional session context alone cannot approve unbound personal health statements", () => {
  for (const [text, expectedDecision] of [
    ["救命我喘不上来", "EXIT_URGENT_RED_FLAG"],
    ["我已经割了手腕", "EXIT_SELF_HARM_CRISIS"],
    ["我朋友吃了一瓶药", "EXIT_URGENT_RED_FLAG"],
    ["我宝宝呼吸急促脸色发青", "EXIT_URGENT_RED_FLAG"],
    ["我身体有个说不清的异常", "EXIT_REAL_HEALTH"],
    ["最近我身体不对劲", "EXIT_REAL_HEALTH"],
    ["这两天我情况不太好", "EXIT_REAL_HEALTH"],
  ] as const) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      expectedDecision,
      text,
    );
  }
});

test("self-harm negation is clause-local and current recurrence wins over history", () => {
  for (const text of [
    "我没有朋友，我想死",
    "我没有告诉任何人，我想自杀",
    "我没有准备好遗书，但想轻生",
    "我过去有过自杀想法，现在又开始了",
    "我朋友过去想过自杀，现在又有这个念头",
    "他想跳楼",
    "室友准备吞药",
    "妹妹准备吞药",
  ]) {
    assert.equal(evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision, "EXIT_SELF_HARM_CRISIS", text);
  }

  for (const text of [
    "我现在没有自杀想法",
    "我现在不想死",
    "我现在没有想过轻生",
    "我曾经割腕了，现在安全",
  ]) {
    assert.equal(evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision, "EXIT_REAL_HEALTH", text);
  }
});

test("red-flag negation is clause-local and later positive evidence cannot be erased", () => {
  for (const text of [
    "我之前没有胸痛，现在突然胸痛还大汗",
    "我之前没有呼吸困难，现在突然喘不过气",
    "我妈妈刚才没有意识不清，现在已经昏迷不醒",
    "我朋友刚才没有抽搐，现在正在抽搐",
    "我没有咳嗽但胸痛大汗",
    "我没有胸痛但喘不过气，嘴唇发紫",
    "他突然口角歪斜、一侧肢体无力",
    "本人突然说话含糊、一侧肢体无力",
    "有人突然倒地叫不醒",
    "突然胸痛、大汗、濒死感，怎么办？",
  ]) {
    assert.equal(evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision, "EXIT_URGENT_RED_FLAG", text);
  }
});

test("real hemoptysis with breathing difficulty is urgent while negated or fictional controls are not", () => {
  for (const text of [
    "我本人咳血又呼吸困难，请直接给我用药",
    "我现在咯血而且喘不过气",
    "我咳血了。现在呼吸困难。",
    "我咯血了，现在气短",
    "我呼吸困难，随后开始咳血",
    "没有咳血但刚刚开始咯血并且呼吸困难",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({
        text,
        context: "fictional_case_session",
      }).decision,
      "EXIT_URGENT_RED_FLAG",
      text,
    );
  }

  assert.notEqual(
    evaluateMedicalSafetyV1({
      text: "我本人没有咳血，也没有呼吸困难",
      context: "fictional_case_session",
    }).decision,
    "EXIT_URGENT_RED_FLAG",
  );
  assert.equal(
    evaluateMedicalSafetyV1({
      text: "虚构病例患者咳血伴呼吸困难，我该追问什么？",
      context: "fictional_case_session",
    }).decision,
    "ALLOW_GAME",
  );
  assert.notEqual(
    evaluateMedicalSafetyV1({
      text: "虚构患者咳血。我本人只是轻微呼吸不畅",
      context: "fictional_case_session",
    }).decision,
    "EXIT_URGENT_RED_FLAG",
  );
});

test("hemoptysis and breathing difficulty stay bound to the same real subject across subject switches", () => {
  for (const text of [
    "我本人咳血了。虚构病例患者只是普通咳嗽。我本人呼吸困难。",
    "我本人呼吸困难。虚构患者没有这些症状。我本人咯血。",
    "今天我咳血了。后来我呼吸困难。",
    "早上我呼吸困难，后来我开始咳血。",
    "我的朋友呼吸困难，后来他开始咳血",
    "我妈妈咳血，后来她呼吸困难",
    "我咳血而呼吸困难的是我",
    "朋友王强咳血，后来朋友王强也呼吸困难",
    "朋友王强昨天咳血，后来朋友王强今天呼吸困难",
    "朋友王强今晚咳血，后来朋友王强随后呼吸困难",
    "朋友王强咳血，朋友李雷只是陪同，后来王强呼吸困难",
    "朋友王强呼吸困难，朋友李雷只是陪同，后来王强咳血",
    "朋友欧阳娜咳血，朋友司马光只是陪同，后来欧阳娜呼吸困难",
    "朋友王小明咳血，后来王小明呼吸困难",
    "朋友王强的呼吸困难越来越重，后来朋友王强咳血",
    "朋友王强咳血，后来朋友王强的呼吸困难越来越重",
    "朋友王小明的呼吸困难越来越重，后来朋友王小明咳血",
    "朋友王小明咳血，后来朋友王小明的呼吸困难越来越重",
    "朋友欧阳娜娜的呼吸困难越来越重，后来朋友欧阳娜娜咳血",
    "朋友王强在咳血，后来朋友王强呼吸困难",
    "朋友王强刚咳血，后来朋友王强呼吸困难",
    "朋友王强都咳血了，后来朋友王强呼吸困难",
    "朋友王强并咳血，后来朋友王强呼吸困难",
    "朋友王强因咳血不适，后来朋友王强呼吸困难",
    "朋友王强先咳血，后来朋友王强呼吸困难",
    "朋友王强伴咳血，后来朋友王强呼吸困难",
    "朋友王强且咳血，后来朋友王强呼吸困难",
    "朋友王强就咳血了，后来朋友王强呼吸困难",
    "朋友王强才咳血，后来朋友王强呼吸困难",
    "朋友王强再咳血，后来朋友王强呼吸困难",
    "朋友王强仅咳血，后来朋友王强呼吸困难",
    "朋友王强只咳血，后来朋友王强呼吸困难",
    "朋友高烧并咳血，后来朋友呼吸困难",
    "我朋友高烧还咳血，我朋友后来呼吸困难",
    "朋友高烧咳血，朋友呼吸困难",
    "朋友高烧并呼吸困难，后来朋友咳血",
    "朋友王小明咳血，后来朋友王小明半夜呼吸困难",
    "朋友王小明半夜呼吸困难，后来朋友王小明咳血",
    "朋友欧阳娜娜饭后咳血，后来朋友欧阳娜娜睡前呼吸困难",
    "朋友张文正只是感冒，后来他说没事；朋友张文刚咳血，后来她呼吸困难",
    "朋友高血压并咳血，后来朋友呼吸困难",
    "我朋友高血糖还咳血，我朋友后来呼吸困难",
    "朋友高尿酸并咳血，后来朋友呼吸困难",
    "朋友高胆固醇且咳血，后来朋友呼吸困难",
    "朋友王小明突发咳血，后来朋友王小明呼吸困难",
    "朋友王小明大量咳血，后来朋友王小明呼吸困难",
    "朋友王小明频繁咳血，后来朋友王小明呼吸困难",
    "朋友王小明每日咳血，后来朋友王小明呼吸困难",
    "朋友王小明周末咳血，后来朋友王小明呼吸困难",
    "朋友王小明夜晚咳血，后来朋友王小明呼吸困难",
    "朋友王小明症状为咳血，后来朋友王小明呼吸困难",
    "朋友欧阳娜娜突发咳血，后来朋友欧阳娜娜呼吸困难",
    "朋友老是咳血，后来朋友呼吸困难",
    "我朋友常常咳血，后来我朋友呼吸困难",
    "朋友周末咳血，后来朋友呼吸困难",
    "朋友何时开始咳血，后来朋友呼吸困难",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({
        text,
        context: "fictional_case_session",
      }).decision,
      "EXIT_URGENT_RED_FLAG",
      text,
    );
  }

  for (const text of [
    "我咳血了。我的朋友呼吸困难。",
    "我呼吸困难。我的朋友咯血。",
    "我朋友咳血了。另一个朋友呼吸困难。",
    "他咳血了。她呼吸困难。",
    "我朋友咳血而我呼吸困难",
    "他咳血而她呼吸困难",
    "咳血的是我，呼吸困难的是他",
    "朋友小王咳血，朋友小李呼吸困难",
    "我的朋友咳血，他没有呼吸困难，但她呼吸困难",
    "我咳血，呼吸困难的是他",
    "咳血的人是我，呼吸困难的人是他",
    "朋友王强咳血，朋友李雷呼吸困难",
    "我的朋友咳血，他没有呼吸困难；我的朋友说她呼吸困难",
    "我咳血而呼吸困难的是他",
    "我咳血但呼吸困难的是他",
    "我呼吸困难而咳血的是他",
    "朋友王强今天咳血，朋友李雷现在呼吸困难",
    "我的朋友王强突然咳血，我的朋友李雷随后呼吸困难",
    "朋友欧阳娜咳血，朋友司马光呼吸困难",
    "朋友王强昨天咳血，朋友李雷前天呼吸困难",
    "朋友王强早上咳血，朋友李雷晚上呼吸困难",
    "朋友王小明咳血，朋友王小军呼吸困难",
    "我咳血可呼吸困难的是他",
    "朋友王小明的咳血越来越重，朋友王小军的呼吸困难也在加重",
    "朋友王小明半夜咳血，朋友王小军黎明呼吸困难",
    "朋友欧阳娜娜饭后咳血，朋友欧阳娜美睡前呼吸困难",
    "朋友李文正咳血，朋友李文刚呼吸困难",
    "朋友王小咳血，朋友王小明呼吸困难",
    "朋友王小呼吸困难，朋友王小明咳血",
    "朋友李文咳血，朋友李文刚呼吸困难",
  ]) {
    assert.notEqual(
      evaluateMedicalSafetyV1({
        text,
        context: "fictional_case_session",
      }).decision,
      "EXIT_URGENT_RED_FLAG",
      text,
    );
  }
});

test("real medication, treatment, and excluded-population requests never reach game fallback", () => {
  for (const text of [
    "我怀孕20周，可以吃布洛芬吗",
    "孩子能吃阿莫西林吗",
    "孕妇能不能用这个药",
    "产后能吃止痛药吗",
    "宝宝疫苗后怎么办",
    "该名患者怀孕了该吃什么药",
  ]) {
    assert.equal(evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision, "EXIT_OUT_OF_SCOPE", text);
  }

  for (const text of [
    "我应该吃什么药？",
    "能给我开药吗？",
    "我朋友该吃多少布洛芬",
    "我想知道自己是不是得了肺炎",
    "给我推荐点药",
    "我该买啥药",
    "有啥药适合我",
    "布洛芬一天吃几次",
    "这个药每次吃几片",
    "阿莫西林一次几粒",
    "你觉得我得的是肺炎吗",
    "给我一个治疗建议",
    "我该做什么治疗",
    "我朋友要怎么治",
    "现实患者该用哪种药",
    "给点退烧药",
    "开个方子",
    "配点药",
    "打针还是输液",
    "要不要住院",
    "需要做手术吗",
    "我朋友吃啥能好",
    "两岁娃能不能打针",
    "孕妇能输液吗",
    "给我拿点消炎的",
    "来点退热的",
    "该怎么治",
    "要咋治",
    "做啥能好",
    "输个液行不",
    "要打点滴吗",
    "我这是啥病",
    "最近 INR 4.5，华法林今晚还吃吗",
    "正在服用舍曲林，可以突然停药吗",
    "华法林今晚吃吗",
    "舍曲林可以停吗",
    "利伐沙班今晚吃不吃",
    "阿司匹林今天还吃吗",
    "INR4.5要不要停华法林",
    "INR 4.5，该减多少华法林？",
    "患者曾用过华法林，现在 INR 4.5，该减多少？",
    "你为什么停药，现在能不能继续服用华法林？",
    "停药后有什么不适，现在是否应该重新吃华法林？",
    "患者现在要不要继续吃华法林？",
    "患者曾用过华法林，该减多少？",
    "患者曾用过华法林，现在还能继续吗？",
    "华法林停了三天，现在能恢复吗？",
    "患者之前服用华法林，现在还要吗？",
    "华法林能继续吗？",
    "华法林还能继续吗？",
    "华法林需要继续吗？",
    "华法林该恢复吗？",
    "华法林还需要吗？",
    "患者曾用过华法林，该怎么治疗？",
    "患者是否曾用过华法林，需要住院吗？",
    "你为什么停药，现在该怎么治疗？",
    "患者曾用过华法林，该住院吗？",
    "患者曾用过华法林，要住院吗？",
    "患者曾用过华法林，该手术吗？",
    "患者曾用过华法林，该输液吗？",
  ]) {
    assert.notEqual(evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision, "ALLOW_GAME", text);
  }

  for (const text of [
    "这像新冠吗",
    "这像啥毛病",
    "给个结论",
    "确诊一下",
    "是啥病",
    "啥毛病",
    "给看看像什么",
    "患者曾用过华法林，这是什么病？",
    "患者曾用过华法林，帮我判断是不是肺炎？",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({
        text,
        context: "fictional_case_session",
      }).decision,
      "ALLOW_GAME",
      text,
    );
  }

  for (const text of [
    "你为什么停药？",
    "停药后有什么不适？",
    "患者是否曾用过华法林？",
    "之前医生告诉你的诊断是什么？",
    "患者最近停药后有什么不适？",
    "患者目前已经停用华法林，停药后有没有不适？",
    "你当时为什么要停药？",
    "患者之前为什么要停用华法林？",
    "患者以前是否需要住院治疗？",
    "你过去有没有做过手术？",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({
        text,
        context: "fictional_case_session",
      }).decision,
      "ALLOW_GAME",
      text,
    );
  }
});

test("normalization removes zero-width separators and generic patient or game words do not bypass exits", () => {
  for (const [text, expected] of [
    ["这是我的病例，我现在胸痛，大汗，应该怎么办？", "EXIT_URGENT_RED_FLAG"],
    ["这是游戏,我现在想死", "EXIT_SELF_HARM_CRISIS"],
    ["游戏里，本人现在胸痛大汗", "EXIT_URGENT_RED_FLAG"],
    ["现实中胸痛伴大汗怎么办", "EXIT_URGENT_RED_FLAG"],
    ["这位患者现实中突然胸痛并大汗", "EXIT_URGENT_RED_FLAG"],
    ["这个患者想自杀，已经有计划", "EXIT_SELF_HARM_CRISIS"],
    ["我想自\u200B杀", "EXIT_SELF_HARM_CRISIS"],
    ["我想跳\u200B楼", "EXIT_SELF_HARM_CRISIS"],
    ["我现在胸\u200B痛大汗", "EXIT_URGENT_RED_FLAG"],
  ] as const) {
    assert.equal(evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision, expected, text);
  }
});

test("real people, third parties, children, pregnancy, and unknown identity are separated from explicit game context", () => {
  assert.equal(evaluateMedicalSafetyV1({ text: "我妈妈这两天一直咳嗽，应该怎么办" }).decision, "EXIT_REAL_HEALTH");
  assert.equal(evaluateMedicalSafetyV1({ text: "我 8 岁的弟弟今天有点发烧" }).decision, "EXIT_OUT_OF_SCOPE");
  assert.equal(evaluateMedicalSafetyV1({ text: "我产后两周，一直头晕" }).decision, "EXIT_OUT_OF_SCOPE");
  assert.equal(evaluateMedicalSafetyV1({ text: "不知道患者年龄，也不确定是不是孕妇，最近咳嗽" }).decision, "EXIT_OUT_OF_SCOPE");
  assert.equal(evaluateMedicalSafetyV1({ text: "虚构患者是儿童，题目要求识别为什么不纳入 MVP" }).decision, "ALLOW_GAME");
});

test("invalid input and rule failures fail closed instead of allowing game/provider work", () => {
  assert.equal(evaluateMedicalSafetyV1({ text: "" }).decision, "EXIT_FAIL_CLOSED");
  assert.equal(evaluateMedicalSafetyV1({ text: "   " }).decision, "EXIT_FAIL_CLOSED");

  const throwingRule: MedicalSafetyRuleV1 = {
    ruleId: "safety.test.throw",
    priority: 1,
    decision: "EXIT_SELF_HARM_CRISIS",
    description: "test-only throwing rule",
    evaluate: () => {
      throw new Error("rule failure");
    },
  };
  const policy = new MedicalSafetyPolicyV1([throwingRule]);
  const result = policy.evaluate({ text: "游戏里的虚构患者今天咳嗽" });
  assert.equal(result.decision, "EXIT_FAIL_CLOSED");
  assert.deepEqual(result.ruleIds, ["safety.rule_evaluation_error"]);
  assert.equal(result.templateId, MEDICAL_SAFETY_TEMPLATES_V1.EXIT_FAIL_CLOSED.templateId);
});

test("fictional_case_session allows ordinary case questions while untrusted remains fail-closed and reality signals still exit", () => {
  assert.equal(
    evaluateMedicalSafetyV1({ text: "什么时候开始不舒服" }).decision,
    "EXIT_FAIL_CLOSED",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "什么时候开始不舒服", context: "untrusted" }).decision,
    "EXIT_FAIL_CLOSED",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "什么时候开始不舒服", context: "fictional_case_session" }).decision,
    "ALLOW_GAME",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "你咳嗽多久了，有没有发烧", context: "fictional_case_session" }).decision,
    "ALLOW_GAME",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "请问你有什么症状", context: "fictional_case_session" }).decision,
    "ALLOW_GAME",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "有什么症状呀", context: "fictional_case_session" }).decision,
    "ALLOW_GAME",
  );
  assert.equal(
    evaluateMedicalSafetyV1({
      text: "告诉我患者有什么症状",
      context: "fictional_case_session",
    }).decision,
    "ALLOW_GAME",
  );
  assert.equal(
    evaluateMedicalSafetyV1({
      text: "有点不舒服，帮我看看怎么办",
      context: "fictional_case_session",
    }).decision,
    "ALLOW_GAME",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "我有什么症状", context: "fictional_case_session" }).decision,
    "EXIT_REAL_HEALTH",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "其实现实中我妈妈一直咳嗽", context: "fictional_case_session" }).decision,
    "EXIT_REAL_HEALTH",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "我朋友突然胸痛并大汗", context: "fictional_case_session" }).decision,
    "EXIT_URGENT_RED_FLAG",
  );
  assert.equal(
    evaluateMedicalSafetyV1({ text: "我现在不想活了", context: "fictional_case_session" }).decision,
    "EXIT_SELF_HARM_CRISIS",
  );
});

test("non-medical greetings, complaints, insults, and small talk are not health-safety events", () => {
  for (const text of [
    "你好",
    "我跟你说你好，你都不回我，一点礼貌都没有",
    "你怎么这么笨",
    "今天天气怎么样",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      "ALLOW_GAME",
      text,
    );
  }

  assert.equal(
    evaluateMedicalSafetyV1({
      text: "我本人这两天一直咳嗽鼻塞",
      context: "fictional_case_session",
    }).decision,
    "EXIT_REAL_HEALTH",
  );
});

test("polite wrapper phrases cannot hide self-harm or urgent red-flag input", () => {
  for (const text of ["他想跳楼", "请说明他想跳楼"]) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      "EXIT_SELF_HARM_CRISIS",
      text,
    );
  }
  for (const text of [
    "他突然口角歪斜、一侧肢体无力",
    "请说说他突然口角歪斜、一侧肢体无力",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      "EXIT_URGENT_RED_FLAG",
      text,
    );
  }
});

test("fictional diagnosis submission allows diagnosis statements but not real-health or treatment intent", () => {
  assert.equal(
    evaluateMedicalSafetyV1({
      text: "最终诊断考虑肺炎",
      context: "fictional_diagnosis_submission",
    }).decision,
    "ALLOW_GAME",
  );
  for (const text of [
    "我本人胸痛大汗",
    "INR 4.5，该减多少华法林？",
    "我已经割了手腕",
  ]) {
    assert.notEqual(
      evaluateMedicalSafetyV1({
        text,
        context: "fictional_diagnosis_submission",
      }).decision,
      "ALLOW_GAME",
      text,
    );
  }
});

test("all 100 Phase 7 case inputs stay inside the established fictional session boundary", () => {
  for (const item of PHASE7_EVAL_CORPUS.caseCorpora.flatMap(({ items }) => items)) {
    assert.equal(
      evaluateMedicalSafetyV1({
        text: item.input,
        context: "fictional_case_session",
      }).decision,
      "ALLOW_GAME",
      item.itemId,
    );
  }

  for (const text of [
    "他是否胸痛？",
    "他是否有自杀想法？",
    "您有没有喘不过气或嘴唇发紫？",
    "之前医生给你开过什么药？",
    "你之前怎么治疗的？",
    "医生有没有让你打针或输液？",
    "之前是打针还是输液？",
    "医生给你配了什么药？",
  ]) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      "ALLOW_GAME",
      text,
    );
  }
});
