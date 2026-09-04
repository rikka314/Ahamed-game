const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |your |previous )?instructions?/i,
  /system prompt/i,
  /(?:系统|system).*(?:提示词|prompt)/iu,
  /(?:忽略|忘掉|不再遵守).{0,40}(?:规则|指令|限制|身份|角色)/u,
  /(?:无视|忽略|不遵守).{0,16}(?:所有|全部)?(?:安全|规则|策略|限制|护栏)/u,
  /(?:不要|无需|不必|别).{0,12}(?:遵守|服从|理会|执行).{0,24}(?:上文|前文|之前|此前|规则|指令|限制|政策)/u,
  /(?:绕过|跳过|规避|避开|关闭|禁用|破解).{0,30}(?:安全|检查|过滤|审查|防护|护栏|规则|限制)/u,
  /(?:安全|输入|内容).{0,20}(?:检查|过滤|审查|防护|护栏).{0,20}(?:绕过|跳过|规避|关闭|禁用)/u,
  /(?:系统|内部|隐藏|后台|私密).{0,16}(?:提示|指令|规则|信息|设定|配置|消息).{0,40}(?:翻译|执行|展示|输出|列出|打印|透露|泄露|编码|base64|转换|转成|十六进制|hex|加密|发给|发送|给我)/iu,
  /(?:调试模式|开发者模式|开发模式|维护模式|管理员|主控制器|无约束角色).{0,60}(?:隐藏|内部|跳过|解除|限制|信息|指令|规则|提示|策略|消息|第一条|展示|输出|打印|无视|发给|发送|给我)/u,
  /(?:最开始|最初|一开始).{0,16}(?:收到|获得|看到).{0,16}(?:消息|内容|文本|指令).{0,24}(?:原样|逐字|完整).{0,12}(?:写|输出|复述|展示|发送|发给)/u,
  /(?:假装|当作).{0,16}(?:没有|不存在|取消|忽略).{0,20}(?:安全|规则|策略|限制|护栏)/u,
  /(?:假装|当作).{0,12}(?:安全|规则|策略|限制|护栏).{0,12}(?:没有|不存在|已取消|无效)/u,
  /(?:安全|规则|策略|限制|护栏).{0,12}(?:不存在|已取消|无效|无需遵守|可以忽略)/u,
  /(?:第一条|首条|最初).{0,16}(?:消息|内容|文本|指令).{0,24}(?:打印|输出|写出|复述|展示|发送|发给)/u,
  /(?:最高优先级命令|新的安全政策|保密限制已经取消)/u,
  /(?:复述|打印|展示|输出|列出).{0,50}(?:完整上下文|隐藏指令|内部字段|内部信息|全部字段|系统提示)/u,
  /(?:允许事实列表之外|事实门控|隐藏信息).{0,50}(?:输出|跳过|公开|解除)/u,
  /(?:不是患者|扮演评估器|患者身份|出题老师|复盘老师|角色设定)/u,
  /无约束角色/u,
];

const TURN_ANSWER_EXTRACTION_PATTERNS = [
  /diagnosis answer/i,
  /tell me the diagnosis/i,
  /(?:请|直接|现在|马上)?(?:告诉我|给我|公布|揭示).{0,40}(?:答案|诊断)/u,
  /(?:答案|诊断).{0,24}(?:告诉我|给我|公布|揭示)/u,
  /(?:标准答案|病例答案|最终诊断|评分表|得分点|拿满分|诊断同义词|病例解析|答案键|隐藏诊断|评分规则)/u,
];

const FABRICATED_TEST_CLAIM_PATTERNS = [
  /(?:已经做过|化验单显示|影像已经|护士说).{0,80}(?:检查|结果|白细胞|阴影|血氧).{0,80}(?:按|记录|认可|当成)/u,
  /(?:替你调用了检查工具|口头宣布|我编的病理报告).{0,80}(?:返回结果|指标|加入记录)/u,
  /检查状态.{0,20}(?:没完成|未完成).{0,60}(?:按|采信|认可).{0,30}(?:阳性|阴性|结果)/u,
];

const EXPLICIT_REAL_HEALTH_PATTERNS = [
  /\b(?:my own|my real|my actual)\b.*\b(?:symptoms?|condition|health)\b/i,
  /\b(?:symptoms?|condition|health)\b.*\b(?:my own|my real|my actual)\b/i,
  /\b(?:i have(?: been)?|i['’]ve(?: been| had)?|i am|i['’]m|i feel|i felt|i developed|i suffer(?:ing)? from)\b.{0,80}\b(?:pain(?:ful)?|fever(?:ish)?|cough(?:ing|ed)?|rash(?:es)?|bleed(?:ing)?|dizz(?:y|iness)|nause(?:a|ous)|vomit(?:ing|ed)?|breathless|shortness of breath|difficulty breathing|hurt(?:s|ing)?|ach(?:e|ing)|symptoms?|condition|unwell|ill|sick)\b/i,
  /\b(?:my|mine)\b.{0,60}\b(?:chest|heart|head|stomach|abdomen|back|throat|breathing|symptoms?|condition|health|diagnosis|medication)\b.{0,40}\b(?:pain(?:ful)?|hurt(?:s|ing)?|ach(?:e|ing)|fever(?:ish)?|cough(?:ing|ed)?|bleed(?:ing)?|dizz(?:y|iness)|unwell|ill|sick)?\b/i,
  /\b(?:i can't breathe|i cannot breathe|i want to hurt myself|i want to die)\b/i,
  /(?:我本人|我自己|我的真实).*(?:症状|病情|健康)/u,
  /(?:症状|病情|健康).*(?:我本人|我自己|我的真实)/u,
  /(?:我|本人|自己).{0,40}(?:胸痛|胸疼|胸闷|心痛|疼痛|头痛|头疼|腹痛|肚子疼|背痛|喉咙痛|发烧|发热|低烧|高烧|咳嗽|咳个不停|呼吸困难|喘不过气|出血|头晕|眩晕|恶心|呕吐|想吐|不舒服|生病|症状|病情)/u,
  /(?:想自杀|想死|伤害自己|不想活)/u,
];

function normalizeSafetyPolicyText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export type PromptInjectionSurfaceV1 = "turn" | "diagnosis_submission";

export function isPromptInjection(
  text: string,
  surface: PromptInjectionSurfaceV1 = "turn",
): boolean {
  const normalizedText = normalizeSafetyPolicyText(text);
  return (
    PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalizedText)) ||
    (surface === "turn" &&
      TURN_ANSWER_EXTRACTION_PATTERNS.some((pattern) =>
        pattern.test(normalizedText)
      )) ||
    isFabricatedTestClaim(normalizedText)
  );
}

export function isFabricatedTestClaim(text: string): boolean {
  const normalizedText = normalizeSafetyPolicyText(text);
  return FABRICATED_TEST_CLAIM_PATTERNS.some((pattern) => pattern.test(normalizedText));
}

export function isExplicitRealHealthInput(text: string): boolean {
  const normalizedText = normalizeSafetyPolicyText(text);
  return EXPLICIT_REAL_HEALTH_PATTERNS.some((pattern) => pattern.test(normalizedText));
}
