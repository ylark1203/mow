/**
 * Clash Verge Rev / Mihomo Party 通用脚本覆写（稳定性与速度优化版）
 *
 * 最终仅保留四个策略组：
 * 1. 节点选择：手动选择订阅中的全部节点；
 * 2. 🇺🇸 US：自动筛选并优选美国线路；
 * 3. 故障转移：当前线路不可用时按顺序切换；
 * 4. GLOBAL：总入口，可在故障转移、节点选择、🇺🇸 US 和 DIRECT 之间选择。
 *
 * 主要功能：
 * - 不排除任何“流量、到期、公告”等伪节点；
 * - 为 proxy-provider 强制开启健康检查；
 * - 🇺🇸 US 使用 select，在筛选出的美国线路中手动选择；
 * - 中国大陆 AI 产品主站强制 DIRECT；
 * - ChatGPT/OpenAI 走 🇺🇸 US；
 * - 常用测速网站走节点选择；
 * - 删除旧 MATCH，统一追加 MATCH,GLOBAL；
 * - 重写被删除策略组的规则引用，并兼容 SUB-RULE；
 * - 开启 unified-delay、tcp-concurrent 和策略选择持久化。
 */
function main(config) {
  // ========================
  // 一、用户可调参数
  // ========================

  const NODE_GROUP = "节点选择";
  const US_GROUP = "🇺🇸 US";
  const FALLBACK_GROUP = "故障转移";
  const GLOBAL_GROUP = "GLOBAL";

  // 正常保持为空，由脚本自动识别机场原总策略组。
  // 自动识别错误时填写原策略组名称，例如：
  // const MANUAL_AIRPORT_GROUP = "SKYLUMO加速器";
  const MANUAL_AIRPORT_GROUP = "";

  // 排查阶段建议 false；确认本地、路由器和机场 IPv6 均稳定后可改为 true。
  const ENABLE_IPV6 = false;

  // 连通性测试端点，正常返回 HTTP 204。
  // 使用 Google generate_204（多数订阅/机场的默认端点）：
  // 代理节点普遍保证可访问 Google，而 Cloudflare 在部分线路上被阻断或路由极差，
  // 会导致节点被误判为不可用。使用 HTTP 而非 HTTPS，避免 TLS 握手问题放大误判。
  const HEALTH_CHECK_URL = "http://www.gstatic.com/generate_204";
  const HEALTH_CHECK_INTERVAL = 300; // 秒
  const HEALTH_CHECK_TIMEOUT = 5000; // 毫秒
  const HEALTH_CHECK_EXPECTED_STATUS = 204;
  const HEALTH_CHECK_MAX_FAILED_TIMES = 2;

  // 中国大陆 AI 产品的主站域名。
  // 仅列出产品专用域名，避免使用 baidu.com、qq.com、aliyun.com 等过宽规则。
  const CN_AI_DOMAINS = [
    // DeepSeek
    "deepseek.com",

    // Kimi / Moonshot AI
    "kimi.com",
    "moonshot.cn",

    // 豆包 / 扣子
    "doubao.com",
    "coze.cn",

    // 通义千问 / Qwen
    "tongyi.com",
    "qwen.ai",

    // 百度文心
    "wenxiaoyan.com",
    "yiyan.baidu.com",

    // 智谱清言 / 智谱开放平台
    "chatglm.cn",
    "bigmodel.cn",

    // 腾讯元宝 / ima
    "yuanbao.tencent.com",
    "ima.qq.com",

    // MiniMax / 海螺 AI
    "minimaxi.com",
    "hailuoai.com",

    // 阶跃星辰 / 百川智能
    "stepfun.com",
    "baichuan-ai.com",

    // 讯飞星火
    "xinghuo.xfyun.cn",

    // 秘塔 AI 搜索 / 天工 AI / 商汤日日新
    "metaso.cn",
    "tiangong.cn",
    "sensenova.cn",

    // 360 AI（只匹配 AI 子域名，不直连整个 360.com）
    "ai.360.com"
  ];

  // 用于识别美国节点名称。
  const US_NODE_REGEX =
    /(?:🇺🇸|美国|美國|United\s*States|America|\bUSA?\b|洛杉矶|洛杉磯|圣何塞|聖何塞|西雅图|西雅圖|纽约|紐約|达拉斯|達拉斯|芝加哥|凤凰城|鳳凰城|硅谷|矽谷|波特兰|波特蘭|迈阿密|邁阿密|华盛顿|華盛頓|费城|費城|亚特兰大|亞特蘭大|波士顿|波士頓|拉斯维加斯|拉斯維加斯|丹佛|盐湖城|鹽湖城|休斯顿|休士頓)/i;

  // proxy-provider 使用的 RE2 兼容筛选字符串。
  const US_PROVIDER_FILTER =
    "(?i)(🇺🇸|美国|美國|United\\s*States|America|\\bUSA?\\b|洛杉矶|洛杉磯|圣何塞|聖何塞|西雅图|西雅圖|纽约|紐約|达拉斯|達拉斯|芝加哥|凤凰城|鳳凰城|硅谷|矽谷|波特兰|波特蘭|迈阿密|邁阿密|华盛顿|華盛頓|费城|費城|亚特兰大|亞特蘭大|波士顿|波士頓|拉斯维加斯|拉斯維加斯|丹佛|盐湖城|鹽湖城|休斯顿|休士頓)";

  // 用于识别旧配置中的美国策略组，例如“🇺🇸美国节点”。
  const US_POLICY_REGEX =
    /(?:🇺🇸|美国|美國|United\s*States|America|\bUSA?\b)/i;

  const BUILTIN_POLICIES = new Set([
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
    "PASS-RULE",
    "COMPATIBLE"
  ]);

  // ========================
  // 二、读取原始配置
  // ========================

  const rules = Array.isArray(config.rules) ? config.rules : [];
  const proxies = Array.isArray(config.proxies) ? config.proxies : [];
  const groups = Array.isArray(config["proxy-groups"])
    ? config["proxy-groups"]
    : [];
  const providers =
    config["proxy-providers"] &&
    typeof config["proxy-providers"] === "object"
      ? config["proxy-providers"]
      : {};

  const nodeNames = proxies
    .map((proxy) => proxy && proxy.name)
    .filter((name) => typeof name === "string" && name.length > 0);

  // 按名称去重，但不排除任何节点，包括伪节点。
  const uniqueNodeNames = [...new Set(nodeNames)];
  const nodeNameSet = new Set(uniqueNodeNames);
  const providerNames = Object.keys(providers);

  // ========================
  // 三、为 provider 开启健康检查
  // ========================

  for (const provider of Object.values(providers)) {
    if (!provider || typeof provider !== "object") continue;

    provider["health-check"] = {
      ...(provider["health-check"] || {}),
      enable: true,
      url: HEALTH_CHECK_URL,
      interval: HEALTH_CHECK_INTERVAL,
      timeout: HEALTH_CHECK_TIMEOUT,
      lazy: true,
      "expected-status": HEALTH_CHECK_EXPECTED_STATUS
    };
  }

  // ========================
  // 四、识别机场原策略组
  // ========================

  // 排除脚本自身可能已创建的四个组，确保重复执行仍然幂等。
  const originalGroups = groups.filter(
    (group) =>
      group &&
      typeof group.name === "string" &&
      group.name !== NODE_GROUP &&
      group.name !== US_GROUP &&
      group.name !== FALLBACK_GROUP &&
      group.name !== GLOBAL_GROUP
  );

  const originalGroupNames = new Set(
    originalGroups.map((group) => group.name)
  );

  const groupMap = new Map(
    originalGroups.map((group) => [group.name, group])
  );

  function getRuleType(rule) {
    if (typeof rule !== "string") return "";
    const index = rule.indexOf(",");
    const value = index >= 0 ? rule.slice(0, index) : rule;
    return value.trim().toUpperCase();
  }

  function stripNoResolve(rule) {
    let value = rule.trim();
    let suffix = "";
    const noResolveRegex = /,\s*no-resolve\s*$/i;

    if (noResolveRegex.test(value)) {
      value = value.replace(noResolveRegex, "");
      suffix = ",no-resolve";
    }

    return { value, suffix };
  }

  // 从普通路由规则最右侧读取策略名；SUB-RULE 最后一项是子规则名，不读取。
  function extractPolicy(rule) {
    if (typeof rule !== "string") return null;
    if (getRuleType(rule) === "SUB-RULE") return null;

    const { value } = stripNoResolve(rule);
    const index = value.lastIndexOf(",");
    return index >= 0 ? value.slice(index + 1).trim() : null;
  }

  const policyUsage = new Map();

  for (const rule of rules) {
    const policy = extractPolicy(rule);
    if (!policy) continue;
    policyUsage.set(policy, (policyUsage.get(policy) || 0) + 1);
  }

  // 递归统计原策略组最终可访问的静态真实节点。
  function collectReachableNodes(groupName, visiting = new Set()) {
    if (visiting.has(groupName)) return new Set();

    const group = groupMap.get(groupName);
    if (!group) return new Set();

    const nextVisiting = new Set(visiting);
    nextVisiting.add(groupName);

    const result = new Set();
    const members = Array.isArray(group.proxies) ? group.proxies : [];

    for (const member of members) {
      if (nodeNameSet.has(member)) {
        result.add(member);
      } else if (groupMap.has(member)) {
        for (const node of collectReachableNodes(member, nextVisiting)) {
          result.add(node);
        }
      }
    }

    if (group["include-all"] || group["include-all-proxies"]) {
      for (const node of uniqueNodeNames) result.add(node);
    }

    return result;
  }

  function detectAirportGroup() {
    if (MANUAL_AIRPORT_GROUP) return MANUAL_AIRPORT_GROUP;

    let bestName = null;
    let bestScore = -1;

    for (const group of originalGroups) {
      const reachableCount = collectReachableNodes(group.name).size;
      const providerCount = Array.isArray(group.use)
        ? group.use.length
        : 0;

      const includeAll = Boolean(
        group["include-all"] ||
        group["include-all-proxies"] ||
        group["include-all-providers"]
      );

      const usageCount = policyUsage.get(group.name) || 0;

      if (
        reachableCount === 0 &&
        providerCount === 0 &&
        !includeAll
      ) {
        continue;
      }

      const score =
        reachableCount * 1000000 +
        providerCount * 100000 +
        (includeAll ? 10000000 : 0) +
        usageCount;

      if (score > bestScore) {
        bestScore = score;
        bestName = group.name;
      }
    }

    if (bestName) return bestName;

    // 兼容原 proxy-groups 信息不完整的订阅。
    let fallbackName = null;
    let fallbackUsage = -1;

    for (const [policy, usage] of policyUsage.entries()) {
      if (
        BUILTIN_POLICIES.has(policy) ||
        policy === NODE_GROUP ||
        policy === US_GROUP ||
        policy === FALLBACK_GROUP ||
        policy === GLOBAL_GROUP ||
        nodeNameSet.has(policy)
      ) {
        continue;
      }

      if (usage > fallbackUsage) {
        fallbackUsage = usage;
        fallbackName = policy;
      }
    }

    return fallbackName;
  }

  const airportGroupName = detectAirportGroup();

  // ========================
  // 五、创建四个策略组
  // ========================

  // 1. 节点选择：全部静态节点 + 全部 provider，供手动选择。
  const nodeSelectionGroup = {
    name: NODE_GROUP,
    type: "select"
  };

  if (uniqueNodeNames.length > 0) {
    nodeSelectionGroup.proxies = uniqueNodeNames;
  }

  if (providerNames.length > 0) {
    nodeSelectionGroup.use = providerNames;
  }

  if (uniqueNodeNames.length === 0 && providerNames.length === 0) {
    nodeSelectionGroup["include-all"] = true;
  }

  // 2. 🇺🇸 US：静态节点直接筛选，provider 节点通过 filter 筛选，供手动选择。
  const staticUsNodes = uniqueNodeNames.filter((name) =>
    US_NODE_REGEX.test(name)
  );

  const usSelectionGroup = {
    name: US_GROUP,
    type: "select"
  };

  if (staticUsNodes.length > 0) {
    usSelectionGroup.proxies = staticUsNodes;
  }

  if (providerNames.length > 0) {
    usSelectionGroup.use = providerNames;
    usSelectionGroup.filter = US_PROVIDER_FILTER;
  }

  // 完全没有静态节点和 provider 时，生成一个明确拒绝连接的非空组。
  if (staticUsNodes.length === 0 && providerNames.length === 0) {
    usSelectionGroup.type = "select";
    usSelectionGroup.proxies = ["REJECT"];
  }

  // 3. 故障转移：按节点顺序选择第一个健康节点。
  const fallbackGroup = {
    name: FALLBACK_GROUP,
    type: "fallback",
    url: HEALTH_CHECK_URL,
    interval: HEALTH_CHECK_INTERVAL,
    timeout: HEALTH_CHECK_TIMEOUT,
    lazy: true,
    "max-failed-times": HEALTH_CHECK_MAX_FAILED_TIMES,
    "expected-status": HEALTH_CHECK_EXPECTED_STATUS
  };

  if (uniqueNodeNames.length > 0) {
    fallbackGroup.proxies = uniqueNodeNames;
  }

  if (providerNames.length > 0) {
    fallbackGroup.use = providerNames;
  }

  if (uniqueNodeNames.length === 0 && providerNames.length === 0) {
    fallbackGroup["include-all"] = true;
  }

  // 4. GLOBAL：按“节点选择 → 🇺🇸 US → 故障转移”的顺序提供选项。
  const globalGroup = {
    name: GLOBAL_GROUP,
    type: "select",
    proxies: [
      NODE_GROUP,
      US_GROUP,
      FALLBACK_GROUP,
      "DIRECT"
    ]
  };

  // 强制只保留四个策略组。
  config["proxy-groups"] = [
    nodeSelectionGroup,
    usSelectionGroup,
    fallbackGroup,
    globalGroup
  ];

  // ========================
  // 六、重写规则策略引用
  // ========================

  function rewriteRulePolicy(rule, resolvePolicy) {
    if (typeof rule !== "string") return rule;

    const { value, suffix } = stripNoResolve(rule);
    const index = value.lastIndexOf(",");
    if (index < 0) return rule;

    const oldPolicy = value.slice(index + 1).trim();
    const newPolicy = resolvePolicy(oldPolicy);

    return `${value.slice(0, index)},${newPolicy}${suffix}`;
  }

  function resolveOldPolicy(policy) {
    // 内置策略、静态真实节点和四个新策略组保持不变。
    if (
      BUILTIN_POLICIES.has(policy) ||
      nodeNameSet.has(policy) ||
      policy === NODE_GROUP ||
      policy === US_GROUP ||
      policy === FALLBACK_GROUP ||
      policy === GLOBAL_GROUP
    ) {
      return policy;
    }

    // 原机场总策略组统一改为“节点选择”。
    if (airportGroupName && policy === airportGroupName) {
      return NODE_GROUP;
    }

    // 原美国类策略组改为新的“🇺🇸 US”。
    if (US_POLICY_REGEX.test(policy)) {
      return US_GROUP;
    }

    // 引用已删除原策略组的规则改为“节点选择”。
    if (originalGroupNames.has(policy)) {
      return NODE_GROUP;
    }

    // 未知策略保持原样，避免误改尚未展开的 provider 节点名称。
    return policy;
  }

  function rewriteRoutingRule(rule, resolvePolicy) {
    // SUB-RULE 最后一项是子规则名称，不是出站策略，不应重写。
    if (getRuleType(rule) === "SUB-RULE") return rule;
    return rewriteRulePolicy(rule, resolvePolicy);
  }

  function isMatchRule(rule) {
    return (
      typeof rule === "string" &&
      /^\s*MATCH\s*,/i.test(rule)
    );
  }

  let rewrittenRules = rules
    .filter((rule) => !isMatchRule(rule))
    .map((rule) => rewriteRoutingRule(rule, resolveOldPolicy));

  // 重写 sub-rules 内真正的策略字段；保留子规则内部的 MATCH。
  const subRules = config["sub-rules"];

  if (subRules && typeof subRules === "object") {
    for (const [subRuleName, subRuleList] of Object.entries(subRules)) {
      if (!Array.isArray(subRuleList)) continue;

      subRules[subRuleName] = subRuleList.map((rule) =>
        rewriteRoutingRule(rule, resolveOldPolicy)
      );
    }
  }

  // 中国大陆 AI 产品统一直连。
  // 放在最前面，优先覆盖订阅中可能存在的代理规则。
  const cnAiDirectRules = CN_AI_DOMAINS.map(
    (domain) => `DOMAIN-SUFFIX,${domain},DIRECT`
  );

  // OpenAI 自有域名优先走美国节点，避免将通用第三方服务整站代理。
  const chatgptRules = [
    `DOMAIN-SUFFIX,chatgpt.com,${US_GROUP}`,
    `DOMAIN-SUFFIX,openai.com,${US_GROUP}`,
    `DOMAIN-SUFFIX,oaistatic.com,${US_GROUP}`,
    `DOMAIN-SUFFIX,oaiusercontent.com,${US_GROUP}`
  ];

  // 常用测速网站走“节点选择”，便于测试当前手动节点。
  const speedTestRules = [
    `DOMAIN-SUFFIX,speedtest.net,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,ookla.com,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,speedtestcustom.com,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,fast.com,${NODE_GROUP}`,
    `DOMAIN,speed.cloudflare.com,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,librespeed.org,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,openspeedtest.com,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,testmy.net,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,nperf.com,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,speedof.me,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,speedcheck.org,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,measurementlab.net,${NODE_GROUP}`,
    `DOMAIN-SUFFIX,speedtest.cn,${NODE_GROUP}`
  ];

  // IP 检测网站走手动节点，便于明确检测当前选择的出口。
  const ipCheckRules = [
    `DOMAIN-SUFFIX,ippure.com,${NODE_GROUP}`
  ];

  // 根据“规则类型 + 匹配对象”去重，移除订阅中的旧冲突规则。
  function getRuleMatchKey(rule) {
    if (typeof rule !== "string") return null;

    const parts = rule.split(",");
    if (parts.length < 2) return null;

    return `${parts[0].trim().toUpperCase()},${parts[1].trim().toLowerCase()}`;
  }

  const forcedRules = [
    ...cnAiDirectRules,
    ...chatgptRules,
    ...speedTestRules,
    ...ipCheckRules
  ];

  const forcedRuleKeys = new Set(
    forcedRules.map(getRuleMatchKey).filter(Boolean)
  );

  rewrittenRules = rewrittenRules.filter((rule) => {
    const key = getRuleMatchKey(rule);
    return !key || !forcedRuleKeys.has(key);
  });

  // 规则只在这里统一写入一次，避免后续赋值覆盖前面的专用规则。
  config.rules = [
    ...cnAiDirectRules,
    ...chatgptRules,
    ...speedTestRules,
    ...ipCheckRules,
    ...rewrittenRules,
    `MATCH,${GLOBAL_GROUP}`
  ];

  // ========================
  // 七、通用性能与持久化优化
  // ========================

  // 关闭 IPv6，避免本地、路由器或机场 IPv6 不稳定导致连接异常。
  config.ipv6 = ENABLE_IPV6;

  // 统一不同协议的延迟测试口径。
  config["unified-delay"] = true;

  // DNS 返回多个 IP 时并发尝试，采用最先连接成功的地址。
  config["tcp-concurrent"] = true;

  // 保存策略组选择和 Fake-IP 映射，减少重启后的抖动。
  config.profile = {
    ...(config.profile || {}),
    "store-selected": true,
    "store-fake-ip": true
  };

  return config;
}
