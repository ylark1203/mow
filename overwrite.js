/**
 * Clash Verge Rev / Mihomo Party 通用脚本覆写（稳定性与速度优化版）
 *
 * 最终仅保留四个策略组：
 * 1. 🚀 Proxies：手动选择订阅中的全部节点；
 * 2. 🇺🇸 US：自动筛选并优选美国线路；
 * 3. 🔄 Fallback：当前线路不可用时按顺序切换；
 * 4. 🐟 Others：未命中任何规则的流量默认出口，可选 DIRECT、🚀 Proxies
 *    （兜底跟随节点选择）或任一单节点，兜底走向完全自主。
 * 订阅中的前置/中转/跳板分组（按名称或 dialer-proxy 引用识别）会被改建为
 * url-test 保留在分组末尾，由内核自动选择延迟最低的前置节点，并以
 * hidden 隐藏；前置节点只作为入口，不出现在上述四个出口分组中；
 * 仅包装内置策略的分组（如“拦截”“关闭”）会被删除，引用它的规则
 * 直接改写为对应内置策略。
 *
 * 主要功能：
 * - 不排除任何“流量、到期、公告”等伪节点；
 * - 为 proxy-provider 强制开启健康检查；
 * - 🇺🇸 US 使用 select，在筛选出的美国线路中手动选择；
 * - 中国大陆 AI 产品主站强制 DIRECT；
 * - 红果短剧正片直连，穿山甲广告 SDK 域名整域 REJECT（跳过开屏/插播广告）；
 * - ChatGPT/OpenAI 走 🇺🇸 US；
 * - 常用测速网站走 🚀 Proxies；
 * - 常用国外网站（Google、YouTube、X、GitHub 等）走 🚀 Proxies；
 * - 注入 GFW 规则集（MetaCubeX meta-rules-dat，活跃维护），被墙网站统一走 🚀 Proxies，
 *   位置在订阅直连规则之后、MATCH 之前；
 * - 删除旧 MATCH，统一追加 MATCH,🐟 Others；
 * - 重写被删除策略组的规则引用，并兼容 SUB-RULE；
 * - 开启 unified-delay、tcp-concurrent 和策略选择持久化。
 */
function main(config) {
  // ========================
  // 一、用户可调参数
  // ========================

  const NODE_GROUP = "🚀 Proxies";
  const US_GROUP = "🇺🇸 US";
  const FALLBACK_GROUP = "🔄 Fallback";
  const OTHERS_GROUP = "🐟 Others";

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

  // 常用国外网站的主站域名，统一走 🚀 Proxies，便于集中管理主力出口。
  // 未列出的国外网站仍会落到末尾的 MATCH 兜底规则，由 🐟 Others 接管。
  const FOREIGN_COMMON_DOMAINS = [
    // Google 系
    "google.com",
    "googleapis.com",
    "gstatic.com",
    "googleusercontent.com",
    "googlevideo.com",
    "youtube.com",
    "ytimg.com",
    "ggpht.com",

    // 社交 / 通讯
    "x.com",
    "twitter.com",
    "twimg.com",
    "facebook.com",
    "fbcdn.net",
    "instagram.com",
    "cdninstagram.com",
    "threads.net",
    "whatsapp.com",
    "telegram.org",
    "t.me",
    "discord.com",
    "discord.gg",
    "discordapp.com",
    "reddit.com",
    "tiktok.com",

    // 开发者常用
    "github.com",
    "githubusercontent.com",
    "githubassets.com",
    "stackoverflow.com",

    // 流媒体
    "netflix.com",
    "nflxvideo.net",
    "spotify.com",

    // 其他常用
    "wikipedia.org",
    "wikimedia.org",
    "medium.com",
    "notion.so"
  ];

  // 红果短剧（字节系）广告拦截规则，整域 REJECT 实现跳过开屏与插播广告。
  // 正片与广告分属不同域名（正片走 byteimg/douyinvod/snssdk 主域，保持直连），
  // 只拦截穿山甲广告 SDK 与广告素材域名，不影响播放。
  // 域名清单参考社区验证的 hongguo-lite 模块（基础版，mihomo 无法 MITM，
  // *.snssdk.com/api/ad/ 路径级拦截不在此列）。
  const HONGGUO_AD_BLOCK_RULES = [
    // 穿山甲 Pangle SDK（关键词覆盖 pangolin-sdk-toutiao 全家及 api-access/log-api 子域）
    "DOMAIN-KEYWORD,pangolin,REJECT",
    "DOMAIN-SUFFIX,pglstatp-toutiao.com,REJECT",
    "DOMAIN-SUFFIX,pglstatp-toutiao-b.com,REJECT",

    // 广告素材签名域（覆盖 p3/p6/p9-ad-sign.byteimg.com）
    "DOMAIN-KEYWORD,-ad-sign.byteimg.com,REJECT",

    // 广告落地页跳转
    "DOMAIN-SUFFIX,zlink.ugsdk.cn,REJECT",

    // 字节广告 API 子域（只拦 ads 前缀，不碰 zijieapi 主域）
    "DOMAIN-REGEX,^ads\\d+-normal\\.zijieapi\\.com$,REJECT"
  ];

  // 可选：红果/番茄系埋点上报域名。默认关闭（false）——
  // 开启可能影响“看广告得金币 / 签到”等奖励入口，出现异常请改回 false。
  const BLOCK_HONGGUO_TRACKING = false;
  const HONGGUO_TRACKING_DOMAINS = [
    "mon.toutiaocloud.net",
    "mon.toutiaocloud.com",
    "i.snssdk.com",
    "i-lq.snssdk.com",
    "is.snssdk.com",
    "is-lq.snssdk.com",
    "log3-applog.fqnovel.com",
    "log5-applog.fqnovel.com",
    "mon-misc.fqnovel.com",
    "mon3-misc.fqnovel.com",
    "mon5-misc.fqnovel.com"
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

  // 用于识别订阅中的前置/中转/跳板分组。
  // 命中的分组不会被删除，而是改建为 url-test，由内核自动选择延迟最低的前置节点。
  const RELAY_GROUP_REGEX = /(?:跳板|前置|中转|relay|transit)/i;

  // 前置/中转分组的默认测速地址。
  // 中转入口多为国内服务器，必须使用中国大陆可达的地址，否则中转节点会被全部误判失败；
  // 原分组自带测速地址时优先沿用。
  const RELAY_HEALTH_CHECK_URL =
    "http://connectivitycheck.platform.hicloud.com/generate_204";

  // url-test 的延迟容差（毫秒），新节点延迟优于当前节点超过该值才切换，避免抖动。
  const RELAY_URL_TEST_TOLERANCE = 100;

  // GLOBAL 是 Mihomo 内置分组名，同样视为内置策略，避免被误识别或改写。
  const BUILTIN_POLICIES = new Set([
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
    "PASS-RULE",
    "COMPATIBLE",
    "GLOBAL"
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

  // 节点 dialer-proxy 引用的目标即前置链分组，无论其名称如何。
  const dialerProxyRefs = new Set(
    proxies
      .map((proxy) => proxy && proxy["dialer-proxy"])
      .filter((value) => typeof value === "string" && value.length > 0)
  );

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
      group.name !== OTHERS_GROUP
  );

  const originalGroupNames = new Set(
    originalGroups.map((group) => group.name)
  );

  const groupMap = new Map(
    originalGroups.map((group) => [group.name, group])
  );

  // 前置/中转分组：按名称正则或 dialer-proxy 引用识别，稍后改建为 url-test 保留。
  const relayGroups = originalGroups.filter(
    (group) =>
      RELAY_GROUP_REGEX.test(group.name) || dialerProxyRefs.has(group.name)
  );
  const relayGroupNames = new Set(relayGroups.map((group) => group.name));

  // 前置节点仅作为入口使用，不作为出口出现在四个固定分组中。
  const relayNodeNames = new Set();
  for (const group of relayGroups) {
    const members = Array.isArray(group.proxies) ? group.proxies : [];
    for (const member of members) {
      if (nodeNameSet.has(member)) relayNodeNames.add(member);
    }
  }

  const exitNodeNames = uniqueNodeNames.filter(
    (name) => !relayNodeNames.has(name)
  );

  // 递归判断分组是否仅由内置策略构成：成员全是内置策略，
  // 或成员是同样仅由内置策略构成的分组（如“🛑 广告拦截”→[不拦截, 拦截]）。
  // 存在多个内置策略时按 REJECT > REJECT-DROP > PASS > DIRECT 优先（拦截优先）。
  function resolveBuiltinOnly(groupName, visiting = new Set()) {
    if (visiting.has(groupName)) return null;

    const group = groupMap.get(groupName);
    if (!group) return null;

    const members = Array.isArray(group.proxies) ? group.proxies : [];
    if (members.length === 0) return null;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(groupName);

    const resolved = [];
    for (const member of members) {
      if (BUILTIN_POLICIES.has(member)) {
        resolved.push(member);
      } else {
        const nested = resolveBuiltinOnly(member, nextVisiting);
        if (nested === null) return null;
        resolved.push(nested);
      }
    }

    for (const preferred of ["REJECT", "REJECT-DROP", "PASS", "DIRECT"]) {
      if (resolved.includes(preferred)) return preferred;
    }
    return resolved[0];
  }

  // 仅包装内置策略的分组会被删除，规则引用它们时直接改写为解析出的内置策略。
  const builtinWrapperByName = new Map();
  for (const group of originalGroups) {
    const target = resolveBuiltinOnly(group.name);
    if (target) builtinWrapperByName.set(group.name, target);
  }

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
      // 前置/中转分组不是机场主分组，不参与评分。
      if (relayGroupNames.has(group.name)) continue;

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
        policy === OTHERS_GROUP ||
        relayGroupNames.has(policy) ||
        builtinWrapperByName.has(policy) ||
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

  // 1. 🚀 Proxies：全部出口静态节点 + 全部 provider，供手动选择。
  const nodeSelectionGroup = {
    name: NODE_GROUP,
    type: "select"
  };

  if (exitNodeNames.length > 0) {
    nodeSelectionGroup.proxies = exitNodeNames;
  }

  if (providerNames.length > 0) {
    nodeSelectionGroup.use = providerNames;
  }

  if (exitNodeNames.length === 0 && providerNames.length === 0) {
    nodeSelectionGroup["include-all"] = true;
  }

  // 2. 🇺🇸 US：静态出口节点直接筛选，provider 节点通过 filter 筛选，供手动选择。
  const staticUsNodes = exitNodeNames.filter((name) =>
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

  // 3. 🔄 Fallback：按节点顺序选择第一个健康节点。
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

  if (exitNodeNames.length > 0) {
    fallbackGroup.proxies = exitNodeNames;
  }

  if (providerNames.length > 0) {
    fallbackGroup.use = providerNames;
  }

  if (exitNodeNames.length === 0 && providerNames.length === 0) {
    fallbackGroup["include-all"] = true;
  }

  // 4. 🐟 Others：未命中任何规则的兜底出口。
  // DIRECT 置首，其次是 🚀 Proxies（选中它即等于兜底流量跟随节点选择），
  // 之后是全部出口节点，可完全自主决定兜底走向。
  const othersGroup = {
    name: OTHERS_GROUP,
    type: "select"
  };

  if (exitNodeNames.length > 0) {
    othersGroup.proxies = ["DIRECT", NODE_GROUP, ...exitNodeNames];
  } else {
    othersGroup.proxies = ["DIRECT", NODE_GROUP];
  }

  if (providerNames.length > 0) {
    othersGroup.use = providerNames;
  }

  if (exitNodeNames.length === 0 && providerNames.length === 0) {
    othersGroup["include-all"] = true;
  }

  // 前置/中转分组：改建为 url-test，内核按延迟自动选择最优前置节点，
  // 保留是因为出口节点的 dialer-proxy 可能引用它们，删除会导致配置失效。
  // 测速地址沿用原分组或默认国内可达地址；成员中纯内置策略及其包装组
  // （如“关闭”→DIRECT）在 url-test 下测速无意义且会因延迟最低而永远胜出，予以剔除；
  // hidden 让其在客户端中不显示。
  const relayUrlTestGroups = relayGroups.map((group) => {
    const members = (Array.isArray(group.proxies) ? group.proxies : []).filter(
      (member) =>
        !BUILTIN_POLICIES.has(member) && !builtinWrapperByName.has(member)
    );

    return {
      ...group,
      type: "url-test",
      proxies: members.length > 0 ? members : ["DIRECT"],
      url: group.url || RELAY_HEALTH_CHECK_URL,
      interval: group.interval || HEALTH_CHECK_INTERVAL,
      timeout: group.timeout || HEALTH_CHECK_TIMEOUT,
      tolerance:
        typeof group.tolerance === "number"
          ? group.tolerance
          : RELAY_URL_TEST_TOLERANCE,
      lazy: true,
      hidden: true
    };
  });

  // 前置分组引用到的其他分组（如专用跳板子组）需一并保留，否则引用悬空。
  const auxGroupNames = new Set();
  const auxGroups = [];
  (function collectAuxGroups(members) {
    for (const member of members) {
      if (auxGroupNames.has(member) || relayGroupNames.has(member)) continue;

      const target = groupMap.get(member);
      if (!target) continue;

      auxGroupNames.add(member);
      auxGroups.push({ ...target, hidden: true });
      collectAuxGroups(Array.isArray(target.proxies) ? target.proxies : []);
    }
  })(relayUrlTestGroups.flatMap((group) => group.proxies || []));

  // 强制只保留四个固定策略组，外加识别到的前置/中转分组及其引用的子分组。
  config["proxy-groups"] = [
    nodeSelectionGroup,
    usSelectionGroup,
    fallbackGroup,
    othersGroup,
    ...relayUrlTestGroups,
    ...auxGroups
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
    // 内置策略、静态真实节点、四个新策略组和保留的前置/辅助分组保持不变。
    if (
      BUILTIN_POLICIES.has(policy) ||
      nodeNameSet.has(policy) ||
      policy === NODE_GROUP ||
      policy === US_GROUP ||
      policy === FALLBACK_GROUP ||
      policy === OTHERS_GROUP ||
      relayGroupNames.has(policy) ||
      auxGroupNames.has(policy)
    ) {
      return policy;
    }

    // 引用仅包装内置策略的已删除分组（如“拦截”）时，改写为对应内置策略。
    if (builtinWrapperByName.has(policy)) {
      return builtinWrapperByName.get(policy);
    }

    // 原机场总策略组统一改为“🚀 Proxies”。
    if (airportGroupName && policy === airportGroupName) {
      return NODE_GROUP;
    }

    // 原美国类策略组改为新的“🇺🇸 US”。
    if (US_POLICY_REGEX.test(policy)) {
      return US_GROUP;
    }

    // 引用已删除原策略组的规则改为“🚀 Proxies”。
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

  // 常用测速网站走“🚀 Proxies”，便于测试当前手动节点。
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

  // 常用国外网站走 🚀 Proxies，主力出口集中在节点选择中管理。
  const foreignCommonRules = FOREIGN_COMMON_DOMAINS.map(
    (domain) => `DOMAIN-SUFFIX,${domain},${NODE_GROUP}`
  );

  // 红果短剧：正片保持直连（字节系域名由订阅国内规则直连），广告域名 REJECT。
  // 必须排在订阅的宽泛直连规则之前，否则广告域名会被抢先放行。
  const hongguoAdBlockRules = [...HONGGUO_AD_BLOCK_RULES];
  if (BLOCK_HONGGUO_TRACKING) {
    for (const domain of HONGGUO_TRACKING_DOMAINS) {
      hongguoAdBlockRules.push(`DOMAIN-SUFFIX,${domain},REJECT`);
    }
  }

  // 基于 MetaCubeX meta-rules-dat（活跃维护）的 GFW 规则集，统一走 🚀 Proxies。
  // 位置在订阅规则之后、MATCH 之前：订阅的国内直连规则优先命中，
  // 被墙网站走节点选择，仍未命中的流量由 🐟 Others 兜底。
  const GFW_RULE_PROVIDER_NAME = "gfw";
  const gfwProxyRule = `RULE-SET,${GFW_RULE_PROVIDER_NAME},${NODE_GROUP}`;

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
    ...ipCheckRules,
    ...foreignCommonRules,
    ...hongguoAdBlockRules,
    gfwProxyRule
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
    ...hongguoAdBlockRules,
    ...chatgptRules,
    ...speedTestRules,
    ...ipCheckRules,
    ...foreignCommonRules,
    ...rewrittenRules,
    gfwProxyRule,
    `MATCH,${OTHERS_GROUP}`
  ];

  // 注入 GFW 规则集（MetaCubeX meta-rules-dat，与订阅自带 rule-providers 同源）。
  // 键名固定，重复执行覆写时覆盖同键，保持幂等。
  config["rule-providers"] = {
    ...(config["rule-providers"] || {}),
    [GFW_RULE_PROVIDER_NAME]: {
      type: "http",
      behavior: "domain",
      format: "mrs",
      interval: 86400,
      path: `./ruleset/${GFW_RULE_PROVIDER_NAME}.mrs`,
      url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/gfw.mrs"
    }
  };

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
