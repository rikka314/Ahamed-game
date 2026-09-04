import type { SafetyDecisionV1 } from "@ahamed/doctor-game-share";

export const MEDICAL_SAFETY_POLICY_VERSION_V1 = "medical-safety-policy-v1" as const;

export type MedicalSafetyExitDecisionV1 = Exclude<SafetyDecisionV1, "ALLOW_GAME">;

export interface MedicalSafetyInputV1 {
  text: string;
  context?:
    | "untrusted"
    | "fictional_case_session"
    | "fictional_diagnosis_submission";
}

export interface MedicalSafetyResultV1 {
  decision: SafetyDecisionV1;
  policyVersion: typeof MEDICAL_SAFETY_POLICY_VERSION_V1;
  ruleIds: string[];
  templateId: string;
  responseText: string;
}

export interface MedicalSafetyTemplateV1 {
  templateId: string;
  text: string;
}

export interface MedicalSafetyRuleMatchV1 {
  matched: boolean;
  evidenceRuleIds?: string[];
}

export interface MedicalSafetyContextV1 {
  text: string;
  normalizedText: string;
  inputContext:
    | "untrusted"
    | "fictional_case_session"
    | "fictional_diagnosis_submission";
  explicitFictionalContext: boolean;
  explicitFictionalRiskSubject: boolean;
  realityOverride: boolean;
  realPersonContext: boolean;
}

export interface MedicalSafetyRuleV1 {
  ruleId: string;
  priority: number;
  decision: SafetyDecisionV1;
  description: string;
  evaluate: (context: MedicalSafetyContextV1) => boolean | MedicalSafetyRuleMatchV1;
}

const SELF_HARM_TEMPLATE =
  "我很重视你说的情况。请立即远离可能伤害自己或他人的物品，并联系一位可信赖的人陪同。若你或对方有迫近危险、已经采取行动或无法确保安全，请立即拨打 120 或 110，或前往最近的急诊。中国大陆也可拨打全国统一心理援助热线 12356 寻求支持。这里不能继续虚构病例问诊。";

export const MEDICAL_SAFETY_TEMPLATES_V1 = {
  EXIT_SELF_HARM_CRISIS: {
    templateId: "safety.self-harm-crisis.zh-CN.v1",
    text: SELF_HARM_TEMPLATE,
  },
  EXIT_URGENT_RED_FLAG: {
    templateId: "safety.urgent-red-flag.zh-CN.v1",
    text: "你描述的是现实中的紧急危险征象，这里不能继续虚构病例问诊，也不能提供诊断或治疗建议。请立即拨打 120，或尽快前往最近的急诊；如现场存在人身危险，也可拨打 110。不要等待本游戏的回复。",
  },
  EXIT_OUT_OF_SCOPE: {
    templateId: "safety.out-of-scope.zh-CN.v1",
    text: "你描述的是现实健康情况，且涉及儿童、孕产妇或身份信息不足等本游戏不处理的人群。这里不能提供个体诊断、用药、剂量或治疗建议；请尽快联系正规医疗机构或合格医务人员评估。若出现明显加重或紧急危险征象，请立即拨打 120 或前往急诊。",
  },
  EXIT_REAL_HEALTH: {
    templateId: "safety.real-health.zh-CN.v1",
    text: "你描述的是现实中的个人健康情况，这里只能进行虚构病例的医学教育模拟，不能提供个体诊断、用药、剂量或治疗建议。请联系正规医疗机构或合格医务人员评估；如症状突然加重或出现紧急危险征象，请立即拨打 120 或前往急诊。",
  },
  EXIT_FAIL_CLOSED: {
    templateId: "safety.fail-closed.zh-CN.v1",
    text: "当前输入无法被安全地确认是虚构病例内容。为避免把现实健康问题当作游戏处理，这里不会继续病例模拟，也不会调用外部模型。请改为明确说明是在讨论虚构患者；如果这是现实健康问题，请联系正规医疗机构或合格医务人员。紧急时请拨打 120 或前往急诊。",
  },
  ALLOW_GAME: {
    templateId: "safety.allow-game.zh-CN.v1",
    text: "已确认是虚构病例或一般医学教育内容，可以继续游戏内问诊。",
  },
} as const satisfies Record<SafetyDecisionV1, MedicalSafetyTemplateV1>;

export const MEDICAL_RED_FLAG_RULES_V1 = [
  { redFlagId: "acute_chest_pain", pattern: /(?:突然|持续|剧烈|压榨样)?(?:胸痛|胸疼|胸口压榨|胸口剧痛|熊口压榨)(?:.{0,12}(?:大汗|濒死感|向左臂放射|痛到左手))?/u },
  { redFlagId: "severe_breathing_difficulty", pattern: /(?:喘不过气|喘不上气|喘不上来|喘不锅气|无法呼吸|不能呼吸|没呼吸了|没有呼吸|呼吸非常困难|说不出完整句子|嘴唇发紫|嘴巴发紫|(?:宝宝|婴儿|孩子).{0,12}呼吸急促.{0,12}(?:脸色|嘴唇).{0,4}(?:发青|青紫|发紫))/u },
  { redFlagId: "hemoptysis_with_breathing_difficulty", pattern: /(?:(?:咳血|咯血).{0,12}(?:呼吸困难|喘不过气|喘不上气|气短)|(?:呼吸困难|喘不过气|喘不上气|气短).{0,12}(?:咳血|咯血))/u },
  { redFlagId: "stroke_signs", pattern: /(?:口角歪斜|脸歪.{0,8}(?:手麻|手脚麻|说不清)|一侧肢体无力|一边手脚(?:动不了|没力气)|半边身子动不了|突然说话含糊|突然言语不清|说不清话|突发面瘫)/u },
  { redFlagId: "uncontrolled_bleeding", pattern: /(?:大出血|大量出血|血止不住|血流不止|喷射性出血|一直大量流血|吐了很多血)/u },
  { redFlagId: "loss_of_consciousness", pattern: /(?:失去意识|昏迷不醒|突然昏倒|晕倒后叫不醒|倒地叫不醒|倒下.{0,8}(?:叫不醒|没反应)|怎么叫都没反应|意识不清)/u },
  { redFlagId: "active_seizure", pattern: /(?:正在抽搐|正在抽畜|持续抽搐|抽搐超过五分钟|反复抽搐|全身抽筋.*不停)/u },
  { redFlagId: "severe_allergic_reaction", pattern: /(?:喉咙肿|过敏后.*喘不过气|全身风团.*呼吸困难|舌头肿大|严重过敏.*快窒息|快窒息)/u },
  { redFlagId: "poisoning_or_overdose", pattern: /(?:(?:误服|吞了|吞下|吃了|喝了|吸入).{0,16}(?:大量|一整瓶|整瓶|一瓶|半瓶|一把|农药|清洁剂|洁厕灵|不明药物|很多药|过量|安眠药|一氧化碳)|(?:一整瓶|整瓶|一瓶|半瓶|一把).{0,10}(?:药|安眠药|清洁剂|洁厕灵).{0,8}(?:吞|吃|喝)|吞药过量|把药全吃了)/u },
  { redFlagId: "obstetric_emergency", pattern: /(?:怀孕|孕期|产后).{0,20}(?:大量出血|剧烈腹痛|抽搐|昏厥|胎动(?:消失|没有了|没了))/u },
  { redFlagId: "severe_abdominal_emergency", pattern: /(?:(?:突然|持续|剧烈).{0,5}(?:腹痛|肚子痛|肚纸.*痛)|肚纸.{0,4}剧烈痛).{0,15}(?:硬得像板|反复呕吐|便血|站不起来|起不来|休克)?/u },
] as const;

const FICTIONAL_PATTERNS = [
  /(?:游戏|病例|题目|教学|模拟|虚构|NPC|npc|角色)(?:里|中|内|的)?/iu,
  /(?:这个|该名|这位)(?:虚拟|虚构)患者/u,
  /(?:虚拟|虚构)患者/u,
  /标准化病人/u,
];

const FICTIONAL_RISK_SUBJECT_PATTERNS = [
  /(?:虚构|虚拟|模拟).{0,8}(?:患者|病人|角色|NPC)/iu,
  /(?:游戏|病例|病例题|题目|教学).{0,10}(?:患者|病人|角色|NPC)/iu,
  /(?:患者|病人|角色|NPC).{0,8}(?:属于|是|为)(?:游戏|病例|题目|虚构|虚拟|模拟)/iu,
  /\bNPC\b/iu,
  /标准化病人/u,
];

const REALITY_OVERRIDE_PATTERNS = [
  /(?:其实|但)(?:现实中|不是游戏|说真的|我本人|我朋友|我家人)/u,
  /(?:现实中|现实里的|真的是)(?:我|家人|朋友|室友|同学)/u,
  /现实(?:中|里|里的|情况)/u,
  /不是(?:虚构|游戏|病例)/u,
];

const REAL_PERSON_PATTERNS = [
  /(?:我|本人|自己|我的|我妈|我爸|妈妈|爸爸|母亲|父亲|老婆|丈夫|妻子|老公|宝宝|婴儿|孩子|儿子|女儿|弟弟|妹妹|哥哥|姐姐|朋友|室友|同学|同事|家人|对象|他|她).{0,24}(?:疼|痛|咳|烧|热|晕|吐|恶心|鼻塞|流鼻涕|乏力|不舒服|难受|出血|呼吸|喘|抽搐|昏|过敏|怀孕|产后|症状|病情|生病|自杀|自伤|轻生|紫砂|想死|不想活|活着没意思|一了百了|结束生命|伤害自己|割腕|割.{0,2}手腕|跳楼|跳河|吞药|吃.{0,8}药|用药|开药|处方|剂量|治疗|诊断|疫苗|脸色发青)/u,
  /我(?:(?!(?:想问|想知道|请问|询问|咨询|了解|患者|病人|病例|角色|NPC|npc|虚构|模拟)).){0,16}(?:身体|健康|情况).{0,8}(?:不对劲|不太好|异常|问题|有问题|状况不好)/u,
  /(?:疼|痛|咳|烧|热|晕|吐|恶心|鼻塞|流鼻涕|乏力|不舒服|难受|出血|呼吸|喘|抽搐|昏|过敏|怀孕|产后|症状|病情|吃药|用药|治疗|诊断).{0,16}(?:的是我|是我|我本人|我朋友|我家人|我同学|我室友)/u,
  /\b(?:these are )?my own real (?:symptoms?|condition|health concerns?)\b/iu,
  /\b(?:i have(?: been)?|i['’]ve(?: been| had)?|i am|i['’]m|i feel|i felt|i developed|i suffer(?:ing)? from)\b.{0,80}\b(?:pain(?:ful)?|fever(?:ish)?|cough(?:ing|ed)?|rash(?:es)?|bleed(?:ing)?|dizz(?:y|iness)|nause(?:a|ous)|vomit(?:ing|ed)?|breathless|shortness of breath|difficulty breathing|hurt(?:s|ing)?|ach(?:e|ing)|symptoms?|condition|unwell|ill|sick)\b/iu,
  /(?:我|我本人|我自己|我妈|我爸|我朋友|我家人).{0,32}(?:患有|得了|糖尿病|高血压|血糖|血压|胰岛素|二甲双胍|慢性病)/u,
];

const REAL_PERSON_REFERENCE_PATTERNS = [
  /(?:^|[,，.。!！?？;；:：\s])(?:我|本人|自己|我本人|我自己|我的|我妈|我爸|我妈妈|我爸爸|我老婆|我妻子|我丈夫|我老公|我朋友|我室友|我同学|我同事|我家人|我对象|我姐姐|我哥哥|我妹妹|我弟弟|我女儿|我儿子)(?:[,，.。!！?？;；:：\s]|[^的])/u,
  /(?:妈妈|爸爸|母亲|父亲|老婆|丈夫|妻子|老公|朋友|室友|同学|同事|家人|对象|弟弟|妹妹|哥哥|姐姐|女儿|儿子)(?:说|有|出现|正在|已经|准备|打算|计划|突然|持续|一直|最近|现在|刚刚|今天|昨晚)/u,
];

const STRONG_REALITY_PATTERNS = [
  /(?:我本人|我自己|我妈|我爸|我妈妈|我爸爸|我老婆|我妻子|我丈夫|我老公|我朋友|我室友|我同学|我同事|我家人|我对象|我姐姐|我哥哥|我妹妹|我弟弟|我女儿|我儿子).{0,32}(?:胸痛|胸疼|疼|痛|咳|烧|发热|晕|吐|恶心|鼻塞|流鼻涕|乏力|不舒服|难受|出血|呼吸困难|喘不过气|抽搐|昏倒|过敏|怀孕|产后|自杀|轻生|想死|不想活|伤害自己|割腕|跳楼|跳河|吞.{0,8}(?:药|整瓶)|吃药|用药|开药|买.{0,4}药|推荐.{0,4}药|处方|剂量|治疗|诊断|疫苗|得的是|得了)/u,
  /(?:^|[,，.。!！?？;；:：\s])我(?:(?!(?:该问|想问|再确认|确认|询问|患者|角色|NPC|npc|病例|题目|虚构|模拟)).){0,24}(?:胸痛|胸疼|咳嗽|发烧|发热|头晕|呕吐|鼻塞|流鼻涕|乏力|不舒服|难受|出血|呼吸困难|喘不过气|抽搐|昏倒|过敏|怀孕|产后|自杀|轻生|想死|不想活|伤害自己|割腕|跳楼|跳河|吞.{0,8}(?:药|整瓶)|吃药|用药|开药|买.{0,4}药|推荐.{0,4}药|处方|剂量|治疗|诊断|疫苗|得的是|得了)/u,
  /我(?:(?!(?:该问|想问|再确认|确认|询问|患者|角色|NPC|npc|病例|题目|虚构|模拟)).){0,24}(?:胸痛|胸疼|咳嗽|发烧|发热|头晕|呕吐|鼻塞|流鼻涕|乏力|不舒服|难受|出血|呼吸困难|喘不过气|抽搐|昏倒|过敏|怀孕|产后|自杀|轻生|想死|不想活|伤害自己|割腕|跳楼|跳河|吞.{0,8}(?:药|整瓶)|吃药|用药|开药|买.{0,4}药|推荐.{0,4}药|处方|剂量|治疗|诊断|疫苗|得的是|得了)/u,
  /(?:给我|适合我|我该|我应该|我需要|我朋友要|现实患者).{0,20}(?:推荐|买|吃|用|服|开|换|停|药|剂量|治疗|怎么治|诊断)/u,
  /(?:药|布洛芬|阿莫西林|抗生素|止痛药).{0,16}(?:适合我|给我|我能|我可以|我该)/u,
  /(?:我的(?:朋友|室友|同学|同事|家人|亲人|亲戚|对象|妈妈|爸爸|姐姐|哥哥|妹妹|弟弟|女儿|儿子)|我(?:朋友|室友|同学|同事|家人|亲人|亲戚|对象|妈妈|爸爸|姐姐|哥哥|妹妹|弟弟|女儿|儿子)|(?:朋友|室友|同学|同事|家人|亲人|亲戚|对象|妈妈|爸爸|母亲|父亲|妻子|丈夫|姐姐|哥哥|妹妹|弟弟|女儿|儿子)(?:现在|正在|刚刚|突然|已经)).{0,32}(?:胸痛|胸疼|疼|痛|咳|烧|发热|晕|吐|恶心|鼻塞|流鼻涕|乏力|不舒服|难受|出血|呼吸困难|喘不过气|喘不上气|抽搐|昏倒|倒地|过敏|自杀|轻生|想死|不想活|伤害自己|割腕|跳楼|跳河|上吊|卧轨|服毒|吞.{0,12}(?:药|整瓶|安眠药))/u,
];

const SELF_HARM_PATTERNS = [
  /(?:想|要|准备|打算|计划|正在|已经|刚刚|今晚|现在).{0,12}(?:自杀|轻生|去死|结束生命|伤害自己|割腕|割.{0,2}手腕|跳楼|跳河|吞药|紫砂)/u,
  /(?:自杀|轻生|割腕|割.{0,2}手腕|跳楼|跳河|吞药).{0,12}(?:想法|计划|准备|正在|已经|刚刚|今晚|现在|了)/u,
  /(?:自杀|自伤|轻生)/u,
  /(?:想死(?:了)?|不想活(?:了)?|活不下去(?:了)?|活着没意思|一了百了|结束这一切)/u,
  /(?:不想再撑下去|想结束自己|活够了|想消失|准备服毒|准备上吊|准备卧轨)/u,
  /i wanna die/iu,
];

const NEGATED_SELF_HARM_PATTERNS = [
  /(?:没有|并无|否认|从没|从未|不再|目前没有|现在没有)(?:再|有|任何|过|想过){0,3}(?:自杀|自伤|轻生|想死|不想活)(?:的)?(?:想法|计划|意图)?/u,
  /不(?:会|要|准备|打算)(?:自杀|自伤|轻生|去死|伤害自己)/u,
  /(?:不|并不|没有)想死/u,
  /(?:自杀|自伤|轻生).{0,8}(?:风险为零|已经排除|只是反面词)/u,
];

const HISTORICAL_SELF_HARM_PATTERNS = [
  /(?:以前|过去|多年前|曾经|小时候).{0,16}(?:自杀|自伤|轻生|想死|不想活|割腕)/u,
  /(?:自杀|自伤|轻生|割腕).{0,12}(?:是过去|发生在多年前|已经过去)/u,
];

const CURRENT_DANGER_PATTERNS = [
  /(?:现在|此刻|正在|已经|刚刚|今晚|马上|手边|楼顶|刀|一瓶药).{0,18}(?:自杀|轻生|想死|不想活|割腕|跳楼|跳河|吞药|伤害自己)/u,
  /(?:割腕了|已经吞|正在跳|准备跳|往下跳|开始伤害自己|现在有刀|今晚就行动|马上出门|准备服毒|准备上吊|准备卧轨)/u,
];

const CURRENT_SELF_HARM_REACTIVATION_PATTERNS = [
  /(?:以前|过去|曾经|多年前).{0,18}(?:自杀|自伤|轻生|想死|割腕).{0,20}(?:现在|如今).{0,12}(?:又|再次|重新|开始|有这个念头|有这种念头)/u,
];

const MEDICAL_ADVICE_PATTERNS = [
  /(?:吃|用|服|开|换|停).{0,10}(?:什么药|哪个药|药物|布洛芬|阿莫西林|止痛药|抗生素)/u,
  /(?:能不能|可不可以|可以吗|该不该|应该|需要).{0,10}(?:吃药|用药|服药|打疫苗|治疗)/u,
  /(?:开药|处方|剂量|多少毫克|怎么治疗|如何治疗|治疗方案|该咋治|咋处理)/u,
  /(?:推荐|介绍|买|选|换).{0,10}(?:药|药物|抗生素|止痛药)/u,
  /(?:什么|啥|哪种|哪个).{0,6}(?:药|药物).{0,10}(?:适合|能吃|该吃|可以买)?/u,
  /(?:药|布洛芬|阿莫西林|抗生素|止痛药).{0,16}(?:一天|每日|每次|一次).{0,8}(?:几次|几片|几粒|多少|怎么吃)/u,
  /(?:一天|每日|每次|一次).{0,8}(?:吃|服|用).{0,8}(?:几次|几片|几粒|多少)/u,
  /(?:治疗建议|治疗意见|该做什么治疗|要怎么治|应该怎么治)/u,
  /(?:能不能|可不可以|是否可以).{0,8}(?:吃|用|服).{0,8}(?:药|这个药|那种药)/u,
  /(?:给|开|配).{0,8}(?:点|个|一些)?(?:退烧药|止痛药|抗生素|药|方子|处方)/u,
  /(?:给我拿|来|给我来).{0,8}(?:点|些)?(?:消炎的|退热的|退烧的|止痛的)/u,
  /(?:打针|输液)(?:还是|或|和|、)(?:打针|输液)/u,
  /(?:要不要|是否要|该不该|需不需要|需要).{0,8}(?:住院|手术|打针|输液)/u,
  /(?:要不要|是否要|该不该|应不应该|需不需要|需要|该|要|应该|能不能|能否|可以|可不可以|是否可以).{0,6}(?:住院|手术|输液|打针|治疗|处理)(?:吗|么|呢|[?？]){0,2}/u,
  /(?:吃|用|服)(?:什么|啥|哪种)(?:药|东西)?(?:能好|有效|合适)/u,
  /(?:该|要|应该).{0,4}(?:怎么|咋).{0,4}(?:治|治疗)|(?:做|弄)(?:什么|啥).{0,4}(?:能好|有效)/u,
  /(?:输个液|打点滴).{0,8}(?:行不|行吗|可以吗|要不要|吗)?/u,
  /(?:二甲双胍|胰岛素|降糖药|降压药|处方药|这个药).{0,16}(?:怎么调|如何调|调多少|加多少|减多少|加量|减量|调整剂量|改剂量)/u,
  /(?:血糖|血压).{0,16}(?:偏高|偏低|不稳|控制不好).{0,20}(?:药|胰岛素|剂量|加多少|减多少)/u,
  /(?:INR|国际标准化比值|凝血指标|血药浓度).{0,24}(?:华法林|抗凝药|药).{0,24}(?:还|继续|停|减|加|换|调整).{0,8}(?:吃|服|用|药|量)?/iu,
  /(?:华法林|舍曲林|抗凝药|抗抑郁药|处方药).{0,24}(?:今晚|今天|现在)?.{0,8}(?:还(?:要|该|能)?|继续|能不能|可不可以|是否|要不要|该不该).{0,8}(?:吃|服|用|停|停药|减量|加量|换药)/u,
  /(?:正在|目前|现在|已经|一直|最近).{0,12}(?:服用|吃|使用|用着).{0,24}(?:可以|能否|能不能|可不可以|是否|要不要|该不该|还要|还该|继续).{0,12}(?:突然)?(?:停药|停用|停服|断药|减量|加量|换药|换用)/u,
];

const DIAGNOSIS_REQUEST_PATTERNS = [
  /(?:是不是|是否|会不会).{0,10}(?:得了|患了|感染了|是).{0,8}(?:病|肺炎|流感|感冒)/u,
  /(?:帮我|给我|能否|可以).{0,10}(?:诊断|判断|看看).{0,10}(?:什么病|是不是病|病情)?/u,
  /(?:最终诊断|真实诊断|我得了什么病|是什么病)/u,
  /(?:你觉得|帮我判断|帮我看看).{0,12}(?:我|本人|朋友)?.{0,8}(?:得的是|得了|是不是|是否是).{0,8}(?:肺炎|流感|感冒|什么病)/u,
  /(?:这|这个|症状|情况).{0,8}(?:像|是不是|是否是).{0,8}(?:新冠|肺炎|流感|感冒|什么病|啥毛病|哪种病)/u,
  /(?:给|下|做).{0,6}(?:个)?(?:结论|诊断)|(?:确诊|诊断).{0,6}(?:一下|看看|是什么)/u,
  /(?:我这|我这是|这|这个)?(?:到底)?(?:是|像)?(?:什么|啥).{0,4}(?:病(?!史)|毛病)/u,
  /(?:给|帮).{0,4}(?:看|看看).{0,6}(?:像|是).{0,4}(?:什么|啥)/u,
];

const OUT_OF_SCOPE_PATTERNS = [
  /(?:\b\d{1,2}\s*岁|小孩|儿童|婴儿|宝宝|未成年|小学生|初中生|孩子|娃).{0,40}(?:疼|痛|咳|烧|发热|鼻塞|不舒服|症状|病情|生病|头晕|呕吐|吃|用|服|药|剂量|疫苗|治疗|打针|输液|手术|住院|怎么办)/u,
  /(?:怀孕|孕妇|孕期|孕周|产后|哺乳期).{0,40}(?:疼|痛|咳|烧|发热|鼻塞|不舒服|症状|病情|头晕|呕吐|吃|用|服|药|剂量|疫苗|治疗|打针|输液|手术|住院|怎么办|能不能|可以)/u,
  /(?:不知道|不清楚|无法确认).{0,12}(?:年龄|几岁|身份|是不是孕妇|是否怀孕)/u,
];

const NONURGENT_REAL_HEALTH_PATTERNS = [
  /(?:鼻塞|流鼻涕|轻微咳嗽|咳嗽|低烧|发热|喉咙痛|喉咙疼|头痛|头晕|乏力|恶心|皮疹|腹泻|胃痛|腰痛|不舒服|症状|病情|自杀|自伤|轻生|想死|割腕)/u,
  /\b(?:these are )?my own real (?:symptoms?|condition|health concerns?)\b/iu,
  /\b(?:i have(?: been)?|i['’]ve(?: been| had)?|i am|i['’]m|i feel|i felt|i developed|i suffer(?:ing)? from)\b.{0,80}\b(?:pain(?:ful)?|fever(?:ish)?|cough(?:ing|ed)?|rash(?:es)?|bleed(?:ing)?|dizz(?:y|iness)|nause(?:a|ous)|vomit(?:ing|ed)?|breathless|shortness of breath|difficulty breathing|hurt(?:s|ing)?|ach(?:e|ing)|symptoms?|condition|unwell|ill|sick)\b/iu,
  /(?:糖尿病|高血压|血糖|血压|胰岛素|二甲双胍|慢性病)/u,
  ...MEDICAL_ADVICE_PATTERNS,
  ...DIAGNOSIS_REQUEST_PATTERNS,
];

const AMBIGUOUS_HEALTH_PATTERNS = [
  /(?:不舒服|难受|有症状|身体不对劲|情况不太好|帮忙看看|怎么办|要不要紧|是不是病)/u,
  /(?:身体|健康).{0,12}(?:异常|不对|问题|状况)/u,
  /(?:疼|痛|晕|烧|咳|吐)/u,
  ...MEDICAL_ADVICE_PATTERNS,
  ...DIAGNOSIS_REQUEST_PATTERNS,
];

const ORDINARY_CASE_QUESTION_PATTERNS = [
  /(?:什么时候|持续多久|多久了|有没有|是否|会不会|最高多少度|哪一天|哪里|哪种|哪个|几次|几片|几粒|严重吗|咳不咳|一样吗|困难吗|还好吗)/u,
  /^(?:(?:请)?(?:告诉|告知)我|请问|请|能否|可以)?(?:你|您|患者|病人|这位患者|这个患者)?(?:目前|现在)?(?:有|出现|感觉到)?(?:什么|哪些|哪方面)(?:症状|不适)(?:吗|么|呢|呀|啊|[?？])?$/u,
  /(?:最困扰|主要|目前).{0,16}(?:症状|情况).{0,8}(?:是什么|有哪些)/u,
  /(?:你|您|患者|病人|他|她).{0,36}(?:胸痛|胸疼|发热|发烧|咳嗽|气短|呼吸困难|喘不过气|自杀|自伤|轻生|想死).{0,8}(?:吗|么|呢|[?？])$/u,
  /(?:发热|发烧|咳嗽|胸痛|胸疼|气短|呼吸困难|喘不过气|自杀|自伤|轻生|想死).{0,12}(?:吗|么|呢|[?？])$/u,
];

const MEDICATION_HISTORY_QUESTION_PATTERNS = [
  /(?:你|您|患者|病人).{0,16}(?:之前|以前|过去|目前|现在).{0,16}(?:在)?(?:吃|吃过|用|用过|服|服过|开过).{0,10}(?:什么药|哪些药|哪种药)/u,
  /(?:之前|以前|过去).{0,12}(?:医生).{0,8}(?:给)?(?:你|您|患者|病人).{0,8}(?:开过|开的).{0,8}(?:什么药|哪些药|哪种药)/u,
  /(?:医生).{0,8}(?:给)?(?:你|您|患者|病人).{0,8}(?:开过|开的).{0,8}(?:什么药|哪些药|哪种药)/u,
  /(?:医生).{0,8}(?:有没有|是否|让|给).{0,8}(?:你|您|患者|病人)?.{0,8}(?:打针|输液|配了.{0,6}药)/u,
  /(?:之前|以前|过去).{0,8}(?:是)?(?:打针|输液).{0,6}(?:还是|或).{0,6}(?:打针|输液)/u,
  /(?:医生).{0,8}(?:给)?(?:你|您|患者|病人).{0,8}(?:配了|配过).{0,8}(?:什么药|哪些药|哪种药)/u,
  /(?:你|您|患者|病人).{0,16}(?:之前|以前|过去).{0,12}(?:怎么|如何|接受过什么).{0,10}(?:治疗|处理)/u,
  /(?:你|您|患者|病人).{0,16}(?:目前|现在|平时|一直|是否|有没有).{0,12}(?:在)?(?:吃|服用|使用).{0,12}(?:药|华法林|舍曲林|利伐沙班|阿司匹林|布洛芬|阿莫西林|二甲双胍)(?:吗|么|呢|[?？])$/u,
  /(?:你|您|患者|病人).{0,12}(?:为什么|为何|什么原因).{0,8}(?:停药|停用|停服|换药|减药|加药)/u,
  /(?:停药|停用|停服|换药|减药|加药)(?:以后|后|之后).{0,24}(?:有什么|有没有|是否|出现|感觉|症状|不适|变化)/u,
  /(?:你|您|患者|病人).{0,16}(?:是否|有没有)?(?:曾经|曾|过去|以前).{0,12}(?:吃过|服过|用过|使用过|吃|服用|使用).{0,12}(?:药|华法林|舍曲林|利伐沙班|阿司匹林|布洛芬|阿莫西林|二甲双胍)/u,
  /(?:你|您|患者|病人).{0,16}(?:目前|现在)?(?:已经|早已|曾经).{0,8}(?:停药|停用|停服|换药|减药|加药).{0,12}(?:药|华法林|舍曲林|利伐沙班|阿司匹林|布洛芬|阿莫西林|二甲双胍)?/u,
];

const CLINICAL_HISTORY_QUESTION_PATTERNS = [
  /(?:之前|以前|过去|曾经).{0,12}(?:医生|医院).{0,16}(?:告诉|说|给出|下过|做过).{0,12}(?:你|您|患者|病人)?.{0,12}(?:诊断|结论|什么病)/u,
  /(?:之前|以前|过去|曾经).{0,12}(?:医生|医院).{0,16}(?:告诉|说|给出|下过|做过).{0,12}(?:你|您|患者|病人)?.{0,12}(?:诊断|结论).{0,8}(?:是什么|什么病)/u,
  /(?:你|您|患者|病人).{0,16}(?:之前|以前|过去|曾经).{0,12}(?:是否|有没有|需要|接受过|做过)?.{0,8}(?:住院|手术|输液|打针|治疗|处理)/u,
];

const MEDICATION_DECISION_ENTITY_PATTERNS = [
  /(?:药物?|处方药|抗凝药?|抗抑郁药?|抗生素|止痛药|降糖药|降压药|华法林|舍曲林|利伐沙班|阿司匹林|布洛芬|阿莫西林|二甲双胍|胰岛素)/u,
  /(?:INR|国际标准化比值|凝血指标|血药浓度)/iu,
];

const MEDICATION_DECISION_INTENT_PATTERNS = [
  /(?:要不要|能不能|可不可以|是否|该不该|应该不应该).{0,10}(?:吃|服|用|停|换|加|减|调)/u,
  /(?:可以|应该).{0,6}(?:吃|服|用|停|换|加|减|调).{0,4}(?:吗|么|呢|[?？])?/u,
  /(?:吃|服|用|停|换|加|减|调).{0,2}(?:不(?:吃|服|用|停|换|加|减|调)|吗|么|呢|[?？])/u,
  /(?:今天|今晚|明天|现在|目前).{0,8}(?:还)?(?:吃|服|用|停).{0,4}(?:吗|么|呢|不吃|不服|不用|不停|[?？])/u,
  /(?:还|继续|突然|直接).{0,6}(?:吃|服|用|停|停药|减量|加量|换药)/u,
  /(?:停药|停用|停服|断药|减量|加量|换药|调量|调整剂量)/u,
  /(?:怎么|如何).{0,6}(?:吃|服|用)|(?:吃|服|用).{0,6}(?:多少|几片|几粒|几次|多大剂量)/u,
  /(?:加|减|调).{0,6}(?:多少|几片|几粒|剂量|用量|药量)/u,
  /(?:不吃|不服|不用|不停).{0,6}(?:可以|行|没事).{0,4}(?:吗|么|呢|[?？])?/u,
];

const MEDICATION_DECISION_MODAL_PATTERNS = [
  /(?:要不要|能不能|可不可以|该不该|应该不应该|是否(?:应该|可以|需要|要)).{0,12}(?:吃|服|用|停|换|加|减|调)/u,
  /(?:要|该|应该|可以).{0,8}(?:吃|服|用|停|换|加|减|调).{0,8}(?:多少|几片|几粒|几次|剂量|用量|药量|吗|么|呢|[?？])?/u,
  /(?:怎么|如何).{0,8}(?:吃|服|用|停|换|加|减|调)/u,
  /(?:吃|服|用|停|换|加|减|调).{0,4}(?:多少|几片|几粒|几次|剂量|用量|药量|不(?:吃|服|用|停|换|加|减|调))/u,
  /(?:今天|今晚|明天|现在|当前).{0,10}(?:还|继续|重新|恢复)?(?:吃|服|用|停).{0,4}(?:吗|么|呢|不吃|不服|不用|不停|[?？])/u,
  /(?:还|继续|重新|恢复).{0,8}(?:吃|服|用|停|换|加|减|调)/u,
  /(?:现在|目前|当前|今天|今晚).{0,10}(?:(?:还)?能(?:否)?|能不能|要不要|还要|还需要|该不该|是否(?:可以|需要)?).{0,8}(?:继续|恢复|重启|还要|还需要)?(?:吗|么|呢|[?？])?/u,
  /(?:(?:还)?能(?:否)?|能不能|可不可以|需不需要|需要|该|应该|该不该|应该不应该|要不要|是否(?:可以|需要|应该|要)?).{0,4}(?:继续|恢复|重启|重新开始|再用|再服|再吃)(?:吃药|服药|用药|吃|服用?|使用?)?(?:吗|么|呢|[?？]){1,2}$/u,
  /(?:继续|恢复|重启|重新开始|再用|再服|再吃|还要|还需要|需要)(?:吗|么|呢|[?？]){1,2}$/u,
];

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isExplicitFictionalContext(text: string): boolean {
  return matchesAny(FICTIONAL_PATTERNS, text);
}

function hasExplicitFictionalRiskSubject(text: string): boolean {
  return matchesAny(FICTIONAL_RISK_SUBJECT_PATTERNS, text);
}

function hasRealityOverride(text: string): boolean {
  if (matchesAny(REALITY_OVERRIDE_PATTERNS, text)) return true;
  return matchesAny(STRONG_REALITY_PATTERNS, text);
}

function hasRealPersonContext(text: string): boolean {
  return matchesAny(REAL_PERSON_PATTERNS, text) || matchesAny(REAL_PERSON_REFERENCE_PATTERNS, text);
}

function splitSafetyClauses(text: string): string[] {
  return text
    .split(/[,，.。!！?？;；:：\n]+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

interface TextMatchRange {
  start: number;
  end: number;
}

function findMatchRanges(patterns: readonly RegExp[], text: string): TextMatchRange[] {
  const ranges: TextMatchRange[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      if (match.index === undefined || match[0].length === 0) continue;
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

function hasUnsafeNonMedicationMedicalIntent(
  text: string,
  inputContext: MedicalSafetyContextV1["inputContext"],
): boolean {
  const intentPatterns =
    inputContext === "fictional_diagnosis_submission"
      ? MEDICAL_ADVICE_PATTERNS
      : [...MEDICAL_ADVICE_PATTERNS, ...DIAGNOSIS_REQUEST_PATTERNS];
  return splitSafetyClauses(text).some((clause) => {
    const historyRanges = findMatchRanges(
      [...MEDICATION_HISTORY_QUESTION_PATTERNS, ...CLINICAL_HISTORY_QUESTION_PATTERNS],
      clause,
    );
    return findMatchRanges(intentPatterns, clause).some(
      (intentRange) =>
        !historyRanges.some(
          (historyRange) =>
            intentRange.start >= historyRange.start && intentRange.end <= historyRange.end,
        ),
    );
  });
}

function hasUnsafeTreatmentIntent(text: string): boolean {
  return splitSafetyClauses(text).some((clause) => {
    const historyRanges = findMatchRanges(
      MEDICATION_HISTORY_QUESTION_PATTERNS,
      clause,
    );
    return findMatchRanges(MEDICAL_ADVICE_PATTERNS, clause).some(
      (intentRange) =>
        !historyRanges.some(
          (historyRange) =>
            intentRange.start >= historyRange.start &&
            intentRange.end <= historyRange.end,
        ),
    );
  });
}

const EXPLICIT_REAL_SUBJECT_BOUNDARY =
  /(?=(?:我本人|我自己|我的朋友|我的室友|我的同学|我的同事|我的家人|我的亲人|我的亲戚|我的对象|我的妈妈|我的爸爸|我的姐姐|我的哥哥|我的妹妹|我的弟弟|我的女儿|我的儿子|我妈妈|我爸爸|我妈|我爸|我老婆|我妻子|我丈夫|我老公|我朋友|我室友|我同学|我同事|我家人|我亲人|我亲戚|我对象|我姐姐|我哥哥|我妹妹|我弟弟|我女儿|我儿子|我现在|我正在|我刚刚|我突然|本人现在|本人正在|朋友现在|朋友正在|朋友刚刚|朋友突然|朋友已经|室友现在|室友正在|室友刚刚|室友突然|室友已经))/u;

const CURRENT_RISK_BOUNDARY =
  /(?=(?:(?:但|可是|不过|然而)?(?:现在|如今|此刻|目前|随后|后来)|已经开始|突然开始))/u;

function splitRiskSegments(text: string): string[] {
  return splitSafetyClauses(text).flatMap((clause) =>
    clause
      .split(EXPLICIT_REAL_SUBJECT_BOUNDARY)
      .flatMap((subjectSegment) => subjectSegment.split(CURRENT_RISK_BOUNDARY))
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0),
  );
}

function isOrdinaryCaseQuestion(text: string): boolean {
  if (
    matchesAny(MEDICATION_HISTORY_QUESTION_PATTERNS, text) ||
    matchesAny(CLINICAL_HISTORY_QUESTION_PATTERNS, text)
  ) {
    return (
      !isUnsafeMedicationDecision(text) &&
      !hasUnsafeNonMedicationMedicalIntent(text, "fictional_case_session")
    );
  }
  return (
    matchesAny(ORDINARY_CASE_QUESTION_PATTERNS, text) &&
    !isUnsafeMedicationDecision(text) &&
    !matchesAny(MEDICAL_ADVICE_PATTERNS, text) &&
    !matchesAny(DIAGNOSIS_REQUEST_PATTERNS, text)
  );
}

function isUnsafeMedicationDecision(text: string): boolean {
  const hasEntity = matchesAny(MEDICATION_DECISION_ENTITY_PATTERNS, text);
  const hasDecisionIntent =
    matchesAny(MEDICATION_DECISION_INTENT_PATTERNS, text) ||
    matchesAny(MEDICATION_DECISION_MODAL_PATTERNS, text);
  if (!hasEntity || !hasDecisionIntent) return false;
  const clauses = splitSafetyClauses(text);
  if (
    clauses.some(
      (clause) =>
        matchesAny(MEDICATION_DECISION_MODAL_PATTERNS, clause) &&
        !matchesAny(MEDICATION_HISTORY_QUESTION_PATTERNS, clause),
    )
  ) {
    return true;
  }
  if (!matchesAny(MEDICATION_HISTORY_QUESTION_PATTERNS, text)) return true;
  return clauses.some(
    (clause) =>
      !matchesAny(MEDICATION_HISTORY_QUESTION_PATTERNS, clause) &&
      matchesAny(MEDICATION_DECISION_ENTITY_PATTERNS, clause) &&
      matchesAny(MEDICATION_DECISION_INTENT_PATTERNS, clause),
  );
}

function isHealthLikeInput(text: string): boolean {
  return (
    isUnsafeMedicationDecision(text) ||
    matchesAny(AMBIGUOUS_HEALTH_PATTERNS, text) ||
    matchesAny(NONURGENT_REAL_HEALTH_PATTERNS, text) ||
    matchesAny(OUT_OF_SCOPE_PATTERNS, text) ||
    matchesAny(SELF_HARM_PATTERNS, text) ||
    MEDICAL_RED_FLAG_RULES_V1.some(({ pattern }) => pattern.test(text))
  );
}

function riskIsBoundToFictionalCase(
  context: MedicalSafetyContextV1,
  clause: string,
): boolean {
  if (hasRealityOverride(clause)) return false;
  if (hasExplicitFictionalRiskSubject(clause)) return true;
  return (
    context.inputContext === "fictional_case_session" &&
    isOrdinaryCaseQuestion(clause)
  );
}

const HEMOPTYSIS_SYMPTOM_PATTERNS = [/(?:咳血|咯血)/u] as const;
const BREATHING_DIFFICULTY_SYMPTOM_PATTERNS = [
  /(?:呼吸困难|喘不过气|喘不上气|气短)/u,
] as const;
const NEGATED_SYMPTOM_PREFIX =
  /(?:没有|没|木有|否认|并无|不是|未曾|未|不曾)(?:任何|明显|再|有|出现|发生|正在|过)*$/u;

function hasNonNegatedSymptom(
  text: string,
  patterns: readonly RegExp[],
): boolean {
  return findMatchRanges(patterns, text).some(({ start }) => {
    const prefix = text.slice(Math.max(0, start - 16), start);
    return !NEGATED_SYMPTOM_PREFIX.test(prefix);
  });
}

type RiskSubjectGender = "male" | "female" | "unspecified";

interface RiskSubjectMarker {
  start: number;
  end: number;
  kind: "named" | "self" | "pronoun" | "fictional";
  key?: string;
  gender?: RiskSubjectGender;
}

const COMPOUND_FRIEND_SURNAMES = [
  "欧阳", "司马", "上官", "诸葛", "东方", "皇甫", "尉迟", "公孙", "慕容",
  "令狐", "轩辕", "夏侯", "长孙", "宇文", "司徒", "申屠", "南宫", "独孤",
  "百里", "澹台", "呼延", "羊舌", "东郭", "第五",
] as const;
const SINGLE_FRIEND_SURNAME_PATTERN = /^[王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文]$/u;
const FRIEND_NAME_STRONG_DESCRIPTION_BOUNDARY_PATTERN = /^(?:\s|[,，.。!！?？;；:：]|的|高血压|高血糖|高血脂|高尿酸|高胆固醇|高烧|高热|低烧|发烧|发热|咳血|咯血|呼吸困难|喘不过气|喘不上气|气短|(?:今|昨|前|明|后)(?:天|日|晚|夜|早|晨)|清晨|凌晨|半夜|黎明|清早|早上|上午|中午|下午|午后|傍晚|晚上|夜间|夜里|白天|饭后|睡前|起床后|这(?:天|日|晚|会儿)|那(?:天|日|晚|会儿)|(?:\d+|一|两|几)(?:秒|分钟|小时|天|日|周|星期|月|年)(?:前|后|来)?|突然|忽然|马上|立刻|随后|后来|同时|接着|现在|目前|当时|最近|近来|刚刚|刚才|方才|不久前|持续|一直|时常|经常|偶尔|反复|再次|慢慢|渐渐|正在|已经|仍然|依然|曾经|开始|出现|只是|仅仅|说|表示|否认|没有|有|感到|觉得|发生|变得|报告|自述|脸色苍白时|自己|本人)/u;
const FRIEND_NAME_WEAK_DESCRIPTION_BOUNDARY_PATTERN = /^[得地在把被因由为跟与和及对向从往替给让令将先后再都并且正刚已曾仍还又也只仅就才便则可会能要想需应伴]/u;
const FRIEND_NAME_ANAPHORIC_LINK_PATTERN = /后来|随后|接着|之后|然后|又|再|仍|继续/u;

interface ExplicitFriendNameCandidate {
  start: number;
  nameStart: number;
  shortName: string;
  longName: string | undefined;
  shortHasBoundary: boolean;
  shortHasStrongBoundary: boolean;
  longHasBoundary: boolean;
}

function hasFriendNameDescriptionBoundary(text: string): boolean {
  return (
    text.length === 0 ||
    FRIEND_NAME_STRONG_DESCRIPTION_BOUNDARY_PATTERN.test(text) ||
    FRIEND_NAME_WEAK_DESCRIPTION_BOUNDARY_PATTERN.test(text)
  );
}

function parseExplicitFriendName(
  text: string,
  start: number,
): Omit<ExplicitFriendNameCandidate, "start" | "nameStart"> | undefined {
  const suffix = text.slice(start);
  if (hasFriendNameDescriptionBoundary(suffix)) return undefined;
  const nicknameCharacters = Array.from(suffix);
  if (
    (nicknameCharacters[0] === "小" || nicknameCharacters[0] === "老") &&
    nicknameCharacters[1] !== undefined &&
    /^\p{Script=Han}$/u.test(nicknameCharacters[1])
  ) {
    return {
      shortName: `${nicknameCharacters[0]}${nicknameCharacters[1]}`,
      longName: undefined,
      shortHasBoundary: true,
      shortHasStrongBoundary: true,
      longHasBoundary: false,
    };
  }
  const compoundSurname = COMPOUND_FRIEND_SURNAMES.find((surname) =>
    suffix.startsWith(surname),
  );
  const firstCharacter = Array.from(suffix)[0];
  const surname =
    compoundSurname ??
    (firstCharacter !== undefined &&
    SINGLE_FRIEND_SURNAME_PATTERN.test(firstCharacter)
      ? firstCharacter
      : undefined);
  if (surname === undefined) return undefined;

  const givenCharacters = Array.from(suffix.slice(surname.length));
  const firstGiven = givenCharacters[0];
  if (firstGiven === undefined || !/^\p{Script=Han}$/u.test(firstGiven)) {
    return undefined;
  }
  const shortName = `${surname}${firstGiven}`;
  const shortRemainder = text.slice(start + shortName.length);
  const secondGiven = givenCharacters[1];
  let longName: string | undefined;
  if (secondGiven !== undefined && /^\p{Script=Han}$/u.test(secondGiven)) {
    longName = `${shortName}${secondGiven}`;
  }
  return {
    shortName,
    longName,
    shortHasBoundary: hasFriendNameDescriptionBoundary(shortRemainder),
    shortHasStrongBoundary:
      shortRemainder.length === 0 ||
      FRIEND_NAME_STRONG_DESCRIPTION_BOUNDARY_PATTERN.test(shortRemainder),
    longHasBoundary:
      longName !== undefined &&
      hasFriendNameDescriptionBoundary(text.slice(start + longName.length)),
  };
}

function findExplicitNamedFriendMarkers(text: string): RiskSubjectMarker[] {
  const candidates: ExplicitFriendNameCandidate[] = [];
  const genericMentionStarts: number[] = [];
  for (const match of text.matchAll(/(?:我的|我)?朋友\s*/gu)) {
    if (match.index === undefined) continue;
    const nameStart = match.index + match[0].length;
    const parsed = parseExplicitFriendName(text, nameStart);
    if (parsed === undefined) {
      genericMentionStarts.push(match.index);
      continue;
    }
    candidates.push({
      start: match.index,
      nameStart,
      ...parsed,
    });
  }
  const repeatedLongNames = new Set(
    [...new Set(candidates.flatMap(({ longName }) => longName ?? []))].filter(
      (longName) =>
        candidates.filter((candidate) => candidate.longName === longName).length >= 2,
    ),
  );
  return candidates.flatMap((candidate) => {
    const hasLinkedGenericMention = genericMentionStarts.some((genericStart) =>
      FRIEND_NAME_ANAPHORIC_LINK_PATTERN.test(
        text.slice(
          Math.min(candidate.start, genericStart),
          Math.max(candidate.start, genericStart),
        ),
      ),
    );
    if (hasLinkedGenericMention) return [];
    const hasLinkedStrongShortMention =
      candidate.shortHasBoundary &&
      candidates.some(
        (other) =>
          other !== candidate &&
          other.shortName === candidate.shortName &&
          other.shortHasStrongBoundary &&
          FRIEND_NAME_ANAPHORIC_LINK_PATTERN.test(
            text.slice(
              Math.min(candidate.start, other.start),
              Math.max(candidate.start, other.start),
            ),
          ),
      );
    const friendName =
      candidate.longName !== undefined &&
      (repeatedLongNames.has(candidate.longName) ||
        (!candidate.shortHasStrongBoundary &&
          !hasLinkedStrongShortMention &&
          candidate.longHasBoundary))
        ? candidate.longName
        : candidate.shortName;
    return [{
      start: candidate.start,
      end: candidate.nameStart + friendName.length,
      kind: "named",
      key: `friend:${friendName}`,
      gender: "unspecified",
    }];
  });
}

const REAL_RISK_SUBJECT_MARKER_PATTERNS: ReadonlyArray<{
  key: string;
  kind: "named" | "self" | "pronoun";
  gender: RiskSubjectGender;
  pattern: RegExp;
}> = [
  { key: "friend:other", kind: "named", gender: "unspecified", pattern: /另(?:一|1)个朋友/u },
  { key: "mother", kind: "named", gender: "female", pattern: /(?:(?:我的|我)?(?:妈妈|母亲|妈))(?!妈)/u },
  { key: "father", kind: "named", gender: "male", pattern: /(?:(?:我的|我)?(?:爸爸|父亲|爸))(?!爸)/u },
  { key: "wife", kind: "named", gender: "female", pattern: /(?:我的|我)?(?:老婆|妻子)/u },
  { key: "husband", kind: "named", gender: "male", pattern: /(?:我的|我)?(?:丈夫|老公)/u },
  { key: "friend", kind: "named", gender: "unspecified", pattern: /(?:我的|我)?朋友/u },
  { key: "roommate", kind: "named", gender: "unspecified", pattern: /(?:我的|我)?室友/u },
  { key: "classmate", kind: "named", gender: "unspecified", pattern: /(?:我的|我)?同学/u },
  { key: "colleague", kind: "named", gender: "unspecified", pattern: /(?:我的|我)?同事/u },
  { key: "family", kind: "named", gender: "unspecified", pattern: /(?:我的|我)?(?:家人|亲人|亲戚)/u },
  { key: "partner", kind: "named", gender: "unspecified", pattern: /(?:我的|我)?对象/u },
  { key: "older-sister", kind: "named", gender: "female", pattern: /(?:我的|我)?姐姐/u },
  { key: "older-brother", kind: "named", gender: "male", pattern: /(?:我的|我)?哥哥/u },
  { key: "younger-sister", kind: "named", gender: "female", pattern: /(?:我的|我)?妹妹/u },
  { key: "younger-brother", kind: "named", gender: "male", pattern: /(?:我的|我)?弟弟/u },
  { key: "daughter", kind: "named", gender: "female", pattern: /(?:我的|我)?女儿/u },
  { key: "son", kind: "named", gender: "male", pattern: /(?:我的|我)?儿子/u },
  { key: "self", kind: "self", gender: "unspecified", pattern: /(?:我本人|我自己|本人|我(?!们|的?(?:朋友|室友|同学|同事|家人|亲人|亲戚|对象|妈妈|爸爸|姐姐|哥哥|妹妹|弟弟|女儿|儿子|妈|爸|老婆|妻子|丈夫|老公)))/u },
  { key: "third-person:he", kind: "pronoun", gender: "male", pattern: /(?<!其)他(?!们)/u },
  { key: "third-person:she", kind: "pronoun", gender: "female", pattern: /她(?!们)/u },
];

function findRiskSubjectMarkers(text: string): RiskSubjectMarker[] {
  const markers: RiskSubjectMarker[] = findExplicitNamedFriendMarkers(text);
  for (const definition of REAL_RISK_SUBJECT_MARKER_PATTERNS) {
    const flags = definition.pattern.flags.includes("g")
      ? definition.pattern.flags
      : `${definition.pattern.flags}g`;
    for (const match of text.matchAll(
      new RegExp(definition.pattern.source, flags),
    )) {
      if (match.index === undefined || match[0].length === 0) continue;
      markers.push({
        start: match.index,
        end: match.index + match[0].length,
        kind: definition.kind,
        key: definition.key,
        gender: definition.gender,
      });
    }
  }
  const namedFriendKeys = new Map<string, string>();
  for (const marker of markers) {
    if (
      marker.kind === "named" &&
      marker.key?.startsWith("friend:") &&
      marker.key !== "friend:other"
    ) {
      namedFriendKeys.set(marker.key.slice("friend:".length), marker.key);
    }
  }
  for (const [friendName, key] of namedFriendKeys) {
    let start = text.indexOf(friendName);
    while (start >= 0) {
      markers.push({
        start,
        end: start + friendName.length,
        kind: "named",
        key,
        gender: "unspecified",
      });
      start = text.indexOf(friendName, start + friendName.length);
    }
  }
  for (const range of findMatchRanges(FICTIONAL_RISK_SUBJECT_PATTERNS, text)) {
    markers.push({ ...range, kind: "fictional" });
  }
  markers.sort((left, right) =>
    left.start - right.start || right.end - right.start - (left.end - left.start),
  );
  const nonOverlapping: RiskSubjectMarker[] = [];
  let coveredUntil = -1;
  for (const marker of markers) {
    if (marker.start < coveredUntil) continue;
    nonOverlapping.push(marker);
    coveredUntil = marker.end;
  }
  return nonOverlapping;
}

function pronounCanReferTo(
  pronounGender: RiskSubjectGender,
  subjectGender: RiskSubjectGender,
): boolean {
  return (
    subjectGender === "unspecified" ||
    pronounGender === subjectGender
  );
}

function hasRealityLinkedHemoptysisBreathingCombination(
  context: MedicalSafetyContextV1,
): boolean {
  let subject: "unknown" | "fictional" | `real:${string}` = "unknown";
  let lastNamedRealSubject:
    | { key: string; gender: RiskSubjectGender }
    | undefined;
  const resolvedSubjectGenders = new Map<string, RiskSubjectGender>();
  let pendingHemoptysis = false;
  let pendingBreathingDifficulty = false;
  const realSubjectSignals = new Map<
    string,
    { hemoptysis: boolean; breathingDifficulty: boolean }
  >();

  const recordSignals = (segment: string): boolean => {
    const hasHemoptysis = hasNonNegatedSymptom(
      segment,
      HEMOPTYSIS_SYMPTOM_PATTERNS,
    );
    const hasBreathingDifficulty = hasNonNegatedSymptom(
      segment,
      BREATHING_DIFFICULTY_SYMPTOM_PATTERNS,
    );
    if (subject.startsWith("real:")) {
      const subjectKey = subject.slice("real:".length);
      const signals = realSubjectSignals.get(subjectKey) ?? {
        hemoptysis: false,
        breathingDifficulty: false,
      };
      signals.hemoptysis ||= hasHemoptysis;
      signals.breathingDifficulty ||= hasBreathingDifficulty;
      realSubjectSignals.set(subjectKey, signals);
      return signals.hemoptysis && signals.breathingDifficulty;
    } else if (subject === "unknown") {
      pendingHemoptysis ||= hasHemoptysis;
      pendingBreathingDifficulty ||= hasBreathingDifficulty;
    }
    return pendingHemoptysis && pendingBreathingDifficulty;
  };

  const selectRealSubject = (subjectKey: string): boolean => {
    subject = `real:${subjectKey}`;
    const signals = realSubjectSignals.get(subjectKey) ?? {
      hemoptysis: false,
      breathingDifficulty: false,
    };
    signals.hemoptysis ||= pendingHemoptysis;
    signals.breathingDifficulty ||= pendingBreathingDifficulty;
    realSubjectSignals.set(subjectKey, signals);
    pendingHemoptysis = false;
    pendingBreathingDifficulty = false;
    return signals.hemoptysis && signals.breathingDifficulty;
  };

  const partitionPostposedSubjectClause = (
    segment: string,
  ): { preceding: string; postposed: string } => {
    if (!/(?:的是|的人是)\s*$/u.test(segment)) {
      return { preceding: segment, postposed: "" };
    }
    const boundaries = [
      ...segment.matchAll(/[,，.。!！?？;；:：\n]|而|但|可|可是|然而|不过|却/gu),
    ];
    const lastBoundary = boundaries.at(-1);
    if (lastBoundary?.index === undefined) {
      return { preceding: "", postposed: segment };
    }
    return {
      preceding: segment.slice(0, lastBoundary.index),
      postposed: segment.slice(lastBoundary.index + lastBoundary[0].length),
    };
  };

  let cursor = 0;
  for (const marker of findRiskSubjectMarkers(context.normalizedText)) {
    const leadingSegment = context.normalizedText.slice(cursor, marker.start);
    const { preceding, postposed } =
      partitionPostposedSubjectClause(leadingSegment);
    if (recordSignals(preceding)) {
      return true;
    }
    if (marker.kind === "fictional") {
      subject = "fictional";
      pendingHemoptysis = false;
      pendingBreathingDifficulty = false;
    } else if (marker.kind === "named") {
      const subjectKey = marker.key!;
      lastNamedRealSubject = {
        key: subjectKey,
        gender:
          resolvedSubjectGenders.get(subjectKey) ??
          marker.gender ??
          "unspecified",
      };
      if (selectRealSubject(subjectKey)) return true;
    } else if (marker.kind === "self") {
      if (selectRealSubject("self")) return true;
    } else if (subject !== "fictional") {
      const antecedent = lastNamedRealSubject;
      const pronounGender = marker.gender ?? "unspecified";
      const hasCompatibleAntecedent =
        antecedent !== undefined &&
        pronounCanReferTo(pronounGender, antecedent.gender);
      const subjectKey = hasCompatibleAntecedent
        ? antecedent.key
        : marker.key!;
      if (
        hasCompatibleAntecedent &&
        antecedent.gender === "unspecified" &&
        pronounGender !== "unspecified"
      ) {
        antecedent.gender = pronounGender;
        resolvedSubjectGenders.set(antecedent.key, pronounGender);
      }
      if (selectRealSubject(subjectKey)) return true;
    }
    if (postposed.length > 0 && recordSignals(postposed)) return true;
    cursor = marker.end;
  }
  return recordSignals(context.normalizedText.slice(cursor));
}

function isCurrentSelfHarmCrisis(context: MedicalSafetyContextV1): boolean {
  if (!matchesAny(SELF_HARM_PATTERNS, context.normalizedText)) return false;
  if (matchesAny(CURRENT_SELF_HARM_REACTIVATION_PATTERNS, context.normalizedText)) {
    return true;
  }
  for (const clause of splitRiskSegments(context.normalizedText)) {
    if (!matchesAny(SELF_HARM_PATTERNS, clause)) continue;
    if (riskIsBoundToFictionalCase(context, clause)) continue;
    if (matchesAny(NEGATED_SELF_HARM_PATTERNS, clause)) continue;
    if (matchesAny(HISTORICAL_SELF_HARM_PATTERNS, clause)) continue;
    if (matchesAny(CURRENT_DANGER_PATTERNS, clause)) return true;
    return true;
  }
  return false;
}

function findRedFlags(context: MedicalSafetyContextV1): string[] {
  const matched = new Set<string>();
  if (hasRealityLinkedHemoptysisBreathingCombination(context)) {
    matched.add("red_flag.hemoptysis_with_breathing_difficulty");
  }
  for (const clause of splitRiskSegments(context.normalizedText)) {
    if (riskIsBoundToFictionalCase(context, clause)) continue;
    for (const { redFlagId, pattern } of MEDICAL_RED_FLAG_RULES_V1) {
      if (redFlagId === "hemoptysis_with_breathing_difficulty") continue;
      if (pattern.test(clause) && !isNegatedRedFlag(redFlagId, clause)) {
        matched.add(`red_flag.${redFlagId}`);
      }
    }
  }
  return [...matched];
}

function isNegatedRedFlag(redFlagId: string, text: string): boolean {
  const negativePrefix = "(?:没有|没|木有|否认|并无|不是)";
  const modifier = "(?:任何|明显|出现|发生|正在)?";
  const patterns: Record<string, RegExp> = {
    acute_chest_pain: new RegExp(`${negativePrefix}${modifier}(?:胸痛|胸疼|胸口痛)`, "u"),
    severe_breathing_difficulty: new RegExp(`${negativePrefix}${modifier}(?:喘不过气|呼吸困难|无法呼吸)`, "u"),
    hemoptysis_with_breathing_difficulty: new RegExp(`${negativePrefix}${modifier}(?:咳血|咯血|呼吸困难|喘不过气|气短)`, "u"),
    stroke_signs: new RegExp(`${negativePrefix}${modifier}(?:口角歪斜|肢体无力|言语不清)`, "u"),
    uncontrolled_bleeding: new RegExp(`${negativePrefix}${modifier}(?:大出血|大量流血|血止不住)`, "u"),
    loss_of_consciousness: new RegExp(`${negativePrefix}${modifier}(?:失去意识|昏迷|昏倒|意识不清)`, "u"),
    active_seizure: new RegExp(`${negativePrefix}${modifier}(?:抽搐|抽筋)`, "u"),
    severe_allergic_reaction: new RegExp(`${negativePrefix}${modifier}(?:严重过敏|呼吸困难|喉咙肿)`, "u"),
    poisoning_or_overdose: new RegExp(`${negativePrefix}${modifier}(?:误服|吞药|过量)`, "u"),
    obstetric_emergency: new RegExp(`${negativePrefix}${modifier}(?:大量出血|剧烈腹痛|抽搐|胎动消失)`, "u"),
    severe_abdominal_emergency: new RegExp(`${negativePrefix}${modifier}(?:剧烈腹痛|剧烈肚子痛)`, "u"),
  };
  return patterns[redFlagId]?.test(text) ?? false;
}

const DEFAULT_RULES: readonly MedicalSafetyRuleV1[] = [
  {
    ruleId: "safety.self_harm_crisis.current.v1",
    priority: 10,
    decision: "EXIT_SELF_HARM_CRISIS",
    description: "Current or imminent self-harm signal for self or a third person; explicit negated, historical, and fictional controls are excluded.",
    evaluate: (context) => isCurrentSelfHarmCrisis(context),
  },
  {
    ruleId: "safety.urgent_red_flag.frozen_set.v1",
    priority: 20,
    decision: "EXIT_URGENT_RED_FLAG",
    description: "Reality-linked urgent danger signal from the eleven frozen MedicalSafetyPolicy v1 red-flag groups.",
    evaluate: (context) => {
      const evidenceRuleIds = findRedFlags(context);
      return { matched: evidenceRuleIds.length > 0, evidenceRuleIds };
    },
  },
  {
    ruleId: "safety.out_of_scope.population.v1",
    priority: 30,
    decision: "EXIT_OUT_OF_SCOPE",
    description: "Reality-linked child, pregnant/postpartum, or unknown population input outside the adult non-urgent MVP.",
    evaluate: (context) =>
      (!context.explicitFictionalRiskSubject || context.realityOverride) &&
      matchesAny(OUT_OF_SCOPE_PATTERNS, context.normalizedText),
  },
  {
    ruleId: "safety.real_health.nonurgent.v1",
    priority: 40,
    decision: "EXIT_REAL_HEALTH",
    description: "Reality-linked non-urgent health input concerning the user or another real person.",
    evaluate: (context) =>
      (!context.explicitFictionalContext || context.realityOverride) &&
      ((context.realPersonContext &&
        (matchesAny(
          NONURGENT_REAL_HEALTH_PATTERNS,
          context.normalizedText,
        ) ||
          (context.inputContext === "fictional_case_session" &&
            isHealthLikeInput(context.normalizedText)))) ||
        isUnsafeMedicationDecision(context.normalizedText) ||
        hasUnsafeTreatmentIntent(context.normalizedText)),
  },
  {
    ruleId: "safety.ambiguous_health.fail_closed.v1",
    priority: 50,
    decision: "EXIT_FAIL_CLOSED",
    description: "Health-like input whose fictional/reality boundary or person/population cannot be established safely.",
    evaluate: (context) =>
      (context.inputContext !== "fictional_case_session" ||
        context.realityOverride) &&
      (!context.explicitFictionalContext || context.realityOverride) &&
      isHealthLikeInput(context.normalizedText),
  },
  {
    ruleId: "safety.game_scope.allow.v1",
    priority: 60,
    decision: "ALLOW_GAME",
    description: "Fallback for confirmed fictional/game or non-personal educational content after every exit rule is evaluated.",
    evaluate: () => true,
  },
];

export const MEDICAL_SAFETY_POLICY_V1 = {
  policyVersion: MEDICAL_SAFETY_POLICY_VERSION_V1,
  decisionPriority: [
    "EXIT_SELF_HARM_CRISIS",
    "EXIT_URGENT_RED_FLAG",
    "EXIT_OUT_OF_SCOPE",
    "EXIT_REAL_HEALTH",
    "EXIT_FAIL_CLOSED",
    "ALLOW_GAME",
  ] as const satisfies readonly SafetyDecisionV1[],
  rules: DEFAULT_RULES,
  templates: MEDICAL_SAFETY_TEMPLATES_V1,
} as const;

function failClosed(ruleId: string): MedicalSafetyResultV1 {
  const template = MEDICAL_SAFETY_TEMPLATES_V1.EXIT_FAIL_CLOSED;
  return {
    decision: "EXIT_FAIL_CLOSED",
    policyVersion: MEDICAL_SAFETY_POLICY_VERSION_V1,
    ruleIds: [ruleId],
    templateId: template.templateId,
    responseText: template.text,
  };
}

function createContext(input: MedicalSafetyInputV1): MedicalSafetyContextV1 {
  const normalizedText = input.text
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const inputContext = input.context ?? "untrusted";
  const realityOverride = hasRealityOverride(normalizedText);
  const realPersonContext = hasRealPersonContext(normalizedText);
  const explicitFictionalText = isExplicitFictionalContext(normalizedText);
  const explicitFictionalRiskSubject = hasExplicitFictionalRiskSubject(normalizedText);
  const unsafeMedicationDecision = isUnsafeMedicationDecision(normalizedText);
  const unsafeMedicalIntent =
    unsafeMedicationDecision ||
    hasUnsafeNonMedicationMedicalIntent(normalizedText, inputContext);
  const ordinaryCaseQuestion =
    isOrdinaryCaseQuestion(normalizedText) && !realityOverride;
  return {
    text: input.text,
    normalizedText,
    inputContext,
    explicitFictionalContext:
      !realityOverride &&
      ((explicitFictionalText &&
        (!unsafeMedicalIntent || ordinaryCaseQuestion)) ||
        (inputContext === "fictional_case_session" &&
          !unsafeMedicalIntent &&
          ordinaryCaseQuestion) ||
        (inputContext === "fictional_diagnosis_submission" &&
          !unsafeMedicalIntent)),
    explicitFictionalRiskSubject,
    realityOverride,
    realPersonContext,
  };
}

export class MedicalSafetyPolicyV1 {
  readonly policyVersion = MEDICAL_SAFETY_POLICY_VERSION_V1;
  readonly rules: readonly MedicalSafetyRuleV1[];

  constructor(rules: readonly MedicalSafetyRuleV1[] = DEFAULT_RULES) {
    this.rules = [...rules].sort((left, right) => left.priority - right.priority);
  }

  evaluate(input: MedicalSafetyInputV1): MedicalSafetyResultV1 {
    if (typeof input?.text !== "string" || input.text.trim().length === 0) {
      return failClosed("safety.invalid_input");
    }
    if (
      input.context !== undefined &&
      input.context !== "untrusted" &&
      input.context !== "fictional_case_session" &&
      input.context !== "fictional_diagnosis_submission"
    ) {
      return failClosed("safety.invalid_context");
    }

    try {
      const context = createContext(input);
      for (const rule of this.rules) {
        const evaluated = rule.evaluate(context);
        const match = typeof evaluated === "boolean" ? { matched: evaluated } : evaluated;
        if (!match.matched) continue;
        const template = MEDICAL_SAFETY_TEMPLATES_V1[rule.decision];
        return {
          decision: rule.decision,
          policyVersion: MEDICAL_SAFETY_POLICY_VERSION_V1,
          ruleIds: [rule.ruleId, ...(match.evidenceRuleIds ?? [])],
          templateId: template.templateId,
          responseText: template.text,
        };
      }
      return failClosed("safety.no_rule_result");
    } catch {
      return failClosed("safety.rule_evaluation_error");
    }
  }
}

const DEFAULT_POLICY = new MedicalSafetyPolicyV1();

export function evaluateMedicalSafetyV1(input: MedicalSafetyInputV1): MedicalSafetyResultV1 {
  return DEFAULT_POLICY.evaluate(input);
}
