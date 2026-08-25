const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |your |previous )?instructions?/i,
  /system prompt/i,
  /diagnosis answer/i,
  /tell me the diagnosis/i,
  /(?:告诉|给我).*(?:答案|诊断)/u,
  /(?:系统|system).*(?:提示词|prompt)/iu,
];

const EXPLICIT_REAL_HEALTH_PATTERNS = [
  /\b(?:my own|my real|my actual)\b.*\b(?:symptoms?|condition|health)\b/i,
  /\b(?:symptoms?|condition|health)\b.*\b(?:my own|my real|my actual)\b/i,
  /(?:我本人|我自己|我的真实).*(?:症状|病情|健康)/u,
  /(?:症状|病情|健康).*(?:我本人|我自己|我的真实)/u,
];

export function isPromptInjection(text: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isExplicitRealHealthInput(text: string): boolean {
  return EXPLICIT_REAL_HEALTH_PATTERNS.some((pattern) => pattern.test(text));
}
