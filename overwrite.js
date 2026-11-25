/**
 * Clash Verge Rev / Mihomo Party 通用脚本覆写（稳定性与速度优化版）
 *
 * 最终仅保留四个策略组：
 * 1. 🚀 Proxies：手动选择订阅中的全部节点；首位是 🔄 Fallback，
 *    因此新装配置默认就走自动故障转移，选中具体节点即回到手动模式；
 * 2. 🇺🇸 US：自动筛选并优选美国线路（独立出口，不设兜底成员）；
 * 3. 🔄 Fallback：当前线路不可用时按顺序切换；
 * 4. 🐟 Others：未命中任何规则的流量默认出口，可选 DIRECT、🚀 Proxies
 *    （兜底跟随节点选择）、🔄 Fallback 或任一单节点，兜底走向完全自主。
 * 订阅中的前置/中转/跳板分组（按 dialer-proxy 引用或名称识别）会被改建为
 * url-test 保留，由内核自动选择延迟最低的前置节点；前置节点只作为入口，
 * 不出现在上述四个出口分组中；仅包装内置策略的分组（如“拦截”“关闭”）
 * 会被删除，引用它的规则直接改写为对应内置策略。
 *
 * 主要功能：
 * - 不排除任何“流量、到期、公告”等伪节点；
 * - 同名节点去重（内核遇到重名节点会判定整份配置非法）；
 * - 为 proxy-provider 强制开启健康检查，并兼容订阅的驼峰 healthCheck 写法；
 * - 🇺🇸 US 使用 select，在筛选出的美国线路中手动选择；
 * - 中国大陆 AI 产品主站强制 DIRECT；
 * - ChatGPT/OpenAI 走 🇺🇸 US；
 * - 常用测速网站走 🚀 Proxies；
 * - 常用国外网站（Google、YouTube、X、GitHub 等）走 🚀 Proxies；
 * - 注入 GFW 规则集（MetaCubeX meta-rules-dat，活跃维护），被墙网站统一走 🚀 Proxies，
 *   位置在订阅的「中国大陆直连」判断之前、MATCH 之前；
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

  // proxy-provider 的健康检查是否使用 lazy（不使用时不计时测速）。
  // 保持 true 可以避免大订阅（上千节点）持续测速占用 CPU；
  // 代价是未测速的节点在 🔄 Fallback 中会被默认视为可用，
  // 需要等当前节点连续失败（max-failed-times）后才会被动切换。
  // 追求「开箱即用秒级切换」且节点数不多时，可改为 false。
  const PROVIDER_HEALTH_CHECK_LAZY = true;

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
    "code.visualstudio.com",
    "vscode.download.prss.microsoft.com",

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

  // GitHub 相关域名。
  // 关键词规则兜住所有含 "github" 的域名：Release 产物与 Issue/README 图片托管在
  // github-production-*-asset-*.s3.amazonaws.com 上，后缀规则无法命中；
  // 这些资源不代理时浏览器会一直等它们，表现为「GitHub 加载很慢、页面一直转圈」。
  const GITHUB_KEYWORD = "github";

  // 不含 "github" 关键词但同样属于 GitHub 工作流的站点。
  const GITHUB_RELATED_DOMAINS = [
    "ghcr.io", // GitHub 容器镜像
    "vscode.dev" // 网页版 VS Code（github.dev 内的编辑器）
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
  // 名称命中只是弱证据：还会要求该分组没有被任何规则引用，
  // 否则机场把总策略组命名为“中转专线”时，全部节点会被误判为入口节点。
  const RELAY_GROUP_REGEX = /(?:跳板|前置|中转|relay|transit)/i;

  // 前置/中转分组的默认测速地址。
  // 中转入口多为国内服务器，必须使用中国大陆可达的地址，否则中转节点会被全部误判失败；
  // 原分组自带测速地址时优先沿用。
  const RELAY_HEALTH_CHECK_URL =
    "http://connectivitycheck.platform.hicloud.com/generate_204";

  // 前置/中转分组的测速间隔。入口节点数量少，切换代价高，
  // 用比出口节点（300 秒）更短的间隔，尽快发现入口不可用；
  // 订阅自带 interval 时优先沿用。
  const RELAY_HEALTH_CHECK_INTERVAL = 60;

  // url-test 的延迟容差（毫秒），新节点延迟优于当前节点超过该值才切换。
  // 中转入口频繁切换会打断已有连接，因此保留较大容差以避免抖动。
  const RELAY_URL_TEST_TOLERANCE = 100;

  // 前置/中转分组是否在客户端中隐藏。
  // 默认可见：入口全挂时出口节点仍会显示“可用”，只有入口分组才能反映真实链路状态。
  const RELAY_GROUP_HIDDEN = false;

  // 需要经代理下载的规则集站点：github / jsdelivr 在国内直连会 TLS 超时。
  // 只有命中这些域名的 http 类 rule-provider 才会被强制走 🚀 Proxies，
  // 国内镜像规则集保持直连，避免代理不可用时国内规则也一起加载失败。
  const RULE_PROVIDER_PROXY_HOSTS = [
    "github.com",
    "githubusercontent.com",
    "githubassets.com",
    "jsdelivr.net",
    "unpkg.com",
    "raw.gitmirror.com"
  ];

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

  // 同名节点在内核里是致命错误（proxy xxx is the duplicate name），
  // 整份配置会直接加载失败，这里按名称保留第一个，并写回 config.proxies。
  const seenNodeNames = new Set();
  const uniqueProxies = proxies.filter((proxy) => {
    const name = proxy && typeof proxy.name === "string" ? proxy.name : "";
    // 无名称的项不在本脚本职责内，原样保留交由内核报错。
    if (!name) return true;
    if (seenNodeNames.has(name)) return false;
    seenNodeNames.add(name);
    return true;
  });

  if (Array.isArray(config.proxies)) config.proxies = uniqueProxies;

  // 按名称去重，但不排除任何节点，包括伪节点。
  const uniqueNodeNames = uniqueProxies
    .map((proxy) => proxy && proxy.name)
    .filter((name) => typeof name === "string" && name.length > 0);

  const nodeNameSet = new Set(uniqueNodeNames);
  const providerNames = Object.keys(providers);

  // 节点 dialer-proxy 引用的目标即前置链分组，无论其名称如何。
  const dialerProxyRefs = new Set(
    uniqueProxies
      .map((proxy) => proxy && proxy["dialer-proxy"])
      .filter((value) => typeof value === "string" && value.length > 0)
  );

  // ---- 规则读取辅助（第六章重写规则时复用）----

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

  // 从普通路由规则最右侧读取策略名；SUB-RULE 的语法是
  // SUB-RULE,<匹配条件>,<子规则名>，最后一项不是策略，不读取。
  function extractPolicy(rule) {
    if (typeof rule !== "string") return null;
    if (getRuleType(rule) === "SUB-RULE") return null;

    const { value } = stripNoResolve(rule);
    const index = value.lastIndexOf(",");
    return index >= 0 ? value.slice(index + 1).trim() : null;
  }

  // 统计每条策略被规则引用的次数：识别机场总策略组、判断是否前置分组都要用。
  const policyUsage = new Map();

  for (const rule of rules) {
    const policy = extractPolicy(rule);
    if (!policy) continue;
    policyUsage.set(policy, (policyUsage.get(policy) || 0) + 1);
  }

  // ========================
  // 三、为 provider 开启健康检查
  // ========================

  for (const provider of Object.values(providers)) {
    if (!provider || typeof provider !== "object") continue;

    // 订阅可能使用驼峰 healthCheck，而内核只认中划线 health-check。
    // 两者并存时内核会忽略 healthCheck，导致订阅自带的测速地址
    // （例如中转入口使用的国内地址）被静默丢弃，入口节点因此被全部误判失败。
    const existing =
      provider["health-check"] && typeof provider["health-check"] === "object"
        ? provider["health-check"]
        : provider.healthCheck && typeof provider.healthCheck === "object"
          ? provider.healthCheck
          : {};

    // 统一收敛到中划线写法，并清掉驼峰键，避免两份配置长期不一致。
    delete provider.healthCheck;

    provider["health-check"] = {
      ...existing,
      enable: true,
      url: existing.url !== undefined ? existing.url : HEALTH_CHECK_URL,
      interval:
        existing.interval !== undefined
          ? existing.interval
          : HEALTH_CHECK_INTERVAL,
      timeout:
        existing.timeout !== undefined
          ? existing.timeout
          : HEALTH_CHECK_TIMEOUT,
      lazy:
        existing.lazy !== undefined ? existing.lazy : PROVIDER_HEALTH_CHECK_LAZY,
      "expected-status":
        existing["expected-status"] !== undefined
          ? existing["expected-status"]
          : HEALTH_CHECK_EXPECTED_STATUS
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
  // 名称命中但被规则大量引用的组是出口分组（机场常把总组命名为“中转专线”），
  // 若当作前置组处理，其全部节点会被移出出口分组，出口列表因此被入口节点污染。
  const relayGroups = originalGroups.filter((group) => {
    if (dialerProxyRefs.has(group.name)) return true;
    if (!RELAY_GROUP_REGEX.test(group.name)) return false;
    return (policyUsage.get(group.name) || 0) === 0;
  });
  const relayGroupNames = new Set(relayGroups.map((group) => group.name));

  // 前置节点仅作为入口使用，不作为出口出现在四个固定分组中。
  // 递归遍历嵌套策略组，避免入口节点经辅助组引用后又混入出口组。
  const relayNodeNames = new Set();
  function collectRelayNodes(groupName, visiting = new Set()) {
    if (visiting.has(groupName)) return;

    const group = groupMap.get(groupName);
    if (!group) return;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(groupName);

    const members = Array.isArray(group.proxies) ? group.proxies : [];
    for (const member of members) {
      if (nodeNameSet.has(member)) {
        relayNodeNames.add(member);
      } else if (groupMap.has(member)) {
        collectRelayNodes(member, nextVisiting);
      }
    }

    if (group["include-all"] || group["include-all-proxies"]) {
      for (const nodeName of uniqueNodeNames) relayNodeNames.add(nodeName);
    }
  }

  for (const group of relayGroups) collectRelayNodes(group.name);

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

    // 带 include-all 的分组实际会包含全部节点，不能当作纯内置策略包装组删除。
    if (
      group["include-all"] ||
      group["include-all-proxies"] ||
      group["include-all-providers"]
    ) {
      return null;
    }

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

      // 评分依据（由强到弱）：被规则引用次数 > include-all > 接入 provider 数 > 静态可达节点数。
      // 旧实现以可达节点数为主，纯 provider 的机场主组会被任意含静态节点的辅助组击败。
      const score =
        usageCount * 1000000000 +
        (includeAll ? 100000000 : 0) +
        providerCount * 1000000 +
        reachableCount;

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

  // 前置分组引用的 provider 只提供入口节点，不作为出口引入四个固定分组：
  // 否则入口节点会出现在出口列表里，选中即断链（没有链式代理，直连入口）。
  const relayProviderNames = new Set();
  for (const group of relayGroups) {
    const useList = Array.isArray(group.use) ? group.use : [];
    for (const providerName of useList) relayProviderNames.add(providerName);
  }
  const exitProviderNames = providerNames.filter(
    (name) => !relayProviderNames.has(name)
  );
  const hasExitProviders = exitProviderNames.length > 0;

  // 完全没有可识别出口时的兜底标记：交给内核 include-all。
  const noKnownExit = exitNodeNames.length === 0 && !hasExitProviders;

  // 1. 🚀 Proxies：全部出口静态节点 + 全部出口 provider，供手动选择。
  // 首位放 🔄 Fallback：新装配置默认即自动故障转移；
  // 用户选中任一具体节点则回到手动模式（store-selected 会记住选择）。
  const nodeSelectionGroup = {
    name: NODE_GROUP,
    type: "select",
    proxies: [FALLBACK_GROUP, ...exitNodeNames]
  };

  if (hasExitProviders) {
    nodeSelectionGroup.use = exitProviderNames;
  }

  if (noKnownExit) {
    nodeSelectionGroup["include-all"] = true;
  }

  // 2. 🇺🇸 US：静态出口节点直接筛选，provider 节点通过 filter 筛选，供手动选择。
  // 该组是 AI 流量的独立出口，刻意不加入兜底成员：
  // 筛选不到美国节点时应表现为“无可用出口”，而不是静默回落到其它线路。
  const staticUsNodes = exitNodeNames.filter((name) =>
    US_NODE_REGEX.test(name)
  );

  const usSelectionGroup = {
    name: US_GROUP,
    type: "select",
    url: HEALTH_CHECK_URL,
    interval: HEALTH_CHECK_INTERVAL,
    timeout: HEALTH_CHECK_TIMEOUT,
    "expected-status": HEALTH_CHECK_EXPECTED_STATUS
  };

  if (staticUsNodes.length > 0) {
    usSelectionGroup.proxies = staticUsNodes;
  }

  if (hasExitProviders) {
    usSelectionGroup.use = exitProviderNames;
    usSelectionGroup.filter = US_PROVIDER_FILTER;
  }

  // 完全没有静态节点和出口 provider 时，生成一个明确拒绝连接的非空组。
  if (staticUsNodes.length === 0 && !hasExitProviders) {
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

  if (hasExitProviders) {
    fallbackGroup.use = exitProviderNames;
  }

  if (noKnownExit) {
    fallbackGroup["include-all"] = true;
  }

  // 4. 🐟 Others：未命中任何规则的兜底出口。
  // DIRECT 置首，其次是 🚀 Proxies（选中它即等于兜底流量跟随节点选择），
  // 接着是 🔄 Fallback（兜底流量也能自动故障转移），之后是全部出口节点。
  const othersGroup = {
    name: OTHERS_GROUP,
    type: "select",
    url: HEALTH_CHECK_URL,
    interval: HEALTH_CHECK_INTERVAL,
    timeout: HEALTH_CHECK_TIMEOUT,
    "expected-status": HEALTH_CHECK_EXPECTED_STATUS,
    proxies: ["DIRECT", NODE_GROUP, FALLBACK_GROUP, ...exitNodeNames]
  };

  if (hasExitProviders) {
    othersGroup.use = exitProviderNames;
  }

  if (noKnownExit) {
    othersGroup["include-all"] = true;
  }

  // 前置/中转分组：改建为 url-test，内核按延迟自动选择最优前置节点，
  // 保留是因为出口节点的 dialer-proxy 可能引用它们，删除会导致配置失效。
  // 测速地址沿用原分组或默认国内可达地址。
  function sanitizeMembers(members) {
    if (!Array.isArray(members)) return [];

    // 只保留仍存在的节点和其他分组，并剔除内置策略及其包装组（如“关闭”→DIRECT）：
    // 它们在 url-test 里测速无意义且延迟最低，会永远胜出。
    return members.filter(
      (member) =>
        typeof member === "string" &&
        !BUILTIN_POLICIES.has(member) &&
        !builtinWrapperByName.has(member) &&
        (nodeNameSet.has(member) || groupMap.has(member))
    );
  }

  // 关键：成员为空时绝不能补 DIRECT。DIRECT 延迟最低，url-test 会永远选中它，
  // 依赖该分组的 dialer-proxy 链会被静默降级为「直连」——只允许入口访问的
  // 出口节点会全部超时，或者本机 IP 被直接暴露给出口。
  const relayUrlTestGroups = relayGroups.map((group) => {
    const members = sanitizeMembers(group.proxies);
    const useProviders = (Array.isArray(group.use) ? group.use : []).filter(
      (providerName) => providerNames.includes(providerName)
    );
    const includeAll = Boolean(
      group["include-all"] ||
        group["include-all-proxies"] ||
        group["include-all-providers"]
    );

    // 没有任何可用入口节点：降级为可手动查看/切换的 select，而不是生成空组，
    // 也绝不改建成 url-test——那种情况下 DIRECT 延迟最低会永远胜出，
    // 依赖该分组的 dialer-proxy 链会被静默降级为「直连」。
    if (members.length === 0 && useProviders.length === 0 && !includeAll) {
      return {
        ...group,
        type: "select",
        proxies: ["DIRECT"],
        hidden: RELAY_GROUP_HIDDEN
      };
    }

    const next = {
      ...group,
      type: "url-test",
      url: group.url || RELAY_HEALTH_CHECK_URL,
      interval: group.interval || RELAY_HEALTH_CHECK_INTERVAL,
      timeout: group.timeout || HEALTH_CHECK_TIMEOUT,
      tolerance:
        typeof group.tolerance === "number"
          ? group.tolerance
          : RELAY_URL_TEST_TOLERANCE,
      "expected-status":
        group["expected-status"] !== undefined
          ? group["expected-status"]
          : HEALTH_CHECK_EXPECTED_STATUS,
      "max-failed-times": HEALTH_CHECK_MAX_FAILED_TIMES,
      lazy: true,
      hidden: RELAY_GROUP_HIDDEN
    };

    if (members.length > 0) {
      next.proxies = members;
    } else {
      delete next.proxies;
    }

    if (useProviders.length > 0) {
      next.use = useProviders;
    } else {
      delete next.use;
    }

    return next;
  });

  // 前置分组引用到的其他分组（如专用跳板子组）需一并保留，否则引用悬空。
  // 隐藏的 select 组在客户端里不可见也就无法切换，会永远停在第一个成员，
  // 因此把 select 类型的辅助组改建为 url-test，让内核按延迟自动选择。
  const auxGroupNames = new Set();
  const auxGroups = [];
  (function collectAuxGroups(members) {
    for (const member of members) {
      if (auxGroupNames.has(member) || relayGroupNames.has(member)) continue;
      // 仅包装内置策略的分组会被删除，引用已由其规则改写承担，不再保留。
      if (builtinWrapperByName.has(member)) continue;

      const target = groupMap.get(member);
      if (!target) continue;

      auxGroupNames.add(member);

      const auxMembers = sanitizeMembers(target.proxies);
      const auxUse = (Array.isArray(target.use) ? target.use : []).filter(
        (providerName) => providerNames.includes(providerName)
      );
      const includeAll = Boolean(
        target["include-all"] ||
          target["include-all-proxies"] ||
          target["include-all-providers"]
      );

      const next = { ...target, hidden: true };

      if (auxMembers.length === 0 && auxUse.length === 0 && !includeAll) {
        // 没有可用成员：同样降级为可手动切换的 select，避免生成空组或自动直连。
        next.type = "select";
        next.proxies = ["DIRECT"];
        delete next.use;
      } else {
        if (auxMembers.length > 0) {
          next.proxies = auxMembers;
        } else {
          delete next.proxies;
        }

        if (auxUse.length > 0) {
          next.use = auxUse;
        } else {
          delete next.use;
        }

        if (!next.type || next.type === "select") {
          next.type = "url-test";
          next.url = next.url || RELAY_HEALTH_CHECK_URL;
          next.interval = next.interval || RELAY_HEALTH_CHECK_INTERVAL;
          next.timeout = next.timeout || HEALTH_CHECK_TIMEOUT;
          next["expected-status"] =
            next["expected-status"] !== undefined
              ? next["expected-status"]
              : HEALTH_CHECK_EXPECTED_STATUS;
          next.tolerance =
            typeof next.tolerance === "number"
              ? next.tolerance
              : RELAY_URL_TEST_TOLERANCE;
          next["max-failed-times"] = HEALTH_CHECK_MAX_FAILED_TIMES;
          next.lazy = true;
        }
      }

      auxGroups.push(next);
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
    // SUB-RULE 的语法是 SUB-RULE,<匹配条件>,<子规则名>，最后一项是子规则名而非出站策略。
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
  // 子规则内的 MATCH 同样引用了机场原策略组，必须一并改写为保留策略，
  // 否则会指向已删除的分组，内核会因引用不存在而拒绝加载配置。
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

  // GitHub 及其静态资源统一走 🚀 Proxies，避免子资源走直连把页面拖住。
  const githubRules = [
    `DOMAIN-KEYWORD,${GITHUB_KEYWORD},${NODE_GROUP}`,
    ...GITHUB_RELATED_DOMAINS.map(
      (domain) => `DOMAIN-SUFFIX,${domain},${NODE_GROUP}`
    )
  ];

  // 基于 MetaCubeX meta-rules-dat（活跃维护）的 GFW 规则集，统一走 🚀 Proxies。
  // 键名固定以保证幂等；加 -mrs 后缀避免与订阅自带的同名 rule-provider 撞车。
  const GFW_RULE_PROVIDER_NAME = "gfw-mrs";
  const LEGACY_GFW_RULE_PROVIDER_NAME = "gfw";
  const GFW_RULE_PROVIDER_URL =
    "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/gfw.mrs";

  const gfwProxyRule = `RULE-SET,${GFW_RULE_PROVIDER_NAME},${NODE_GROUP}`;

  // 根据“规则类型 + 匹配对象”去重，移除订阅中的旧冲突规则。
  function getRuleMatchKey(rule) {
    if (typeof rule !== "string") return null;

    const parts = rule.split(",");
    if (parts.length < 2) return null;

    return `${parts[0].trim().toUpperCase()},${parts[1].trim().toLowerCase()}`;
  }

  // 判断一条规则是否为「中国大陆」归属判断（GEOIP/GEOSITE 的 cn 类规则）。
  // gfw 规则集必须排在它们之前：被墙域名常解析到大陆 IP（CDN 回落），
  // 若 GEOIP,CN,DIRECT 先命中就会直连，表现为「明明有节点却打不开」。
  function isCnGeoRule(rule) {
    if (typeof rule !== "string") return false;

    const parts = rule.split(",");
    const type = (parts[0] || "").trim().toUpperCase();
    const payload = (parts[1] || "").trim().toLowerCase();

    if (type === "GEOIP" || type === "SRC-GEOIP") return payload === "cn";
    if (type === "GEOSITE") {
      return (
        payload === "cn" ||
        payload === "geolocation-cn" ||
        payload === "tld-cn"
      );
    }
    return false;
  }

  const forcedRules = [
    ...cnAiDirectRules,
    ...chatgptRules,
    ...speedTestRules,
    ...ipCheckRules,
    ...foreignCommonRules,
    ...githubRules,
    gfwProxyRule
  ];

  const forcedRuleKeys = new Set(
    forcedRules.map(getRuleMatchKey).filter(Boolean)
  );

  rewrittenRules = rewrittenRules.filter((rule) => {
    const key = getRuleMatchKey(rule);
    return !key || !forcedRuleKeys.has(key);
  });

  // 把 gfw 规则集插到订阅的第一条中国大陆归属判断之前。
  const cnGeoIndex = rewrittenRules.findIndex(isCnGeoRule);
  const rulesBeforeCnGeo =
    cnGeoIndex < 0 ? rewrittenRules : rewrittenRules.slice(0, cnGeoIndex);
  const rulesAfterCnGeo =
    cnGeoIndex < 0 ? [] : rewrittenRules.slice(cnGeoIndex);

  // 规则只在这里统一写入一次，避免后续赋值覆盖前面的专用规则。
  config.rules = [
    ...cnAiDirectRules,
    ...chatgptRules,
    ...speedTestRules,
    ...ipCheckRules,
    ...foreignCommonRules,
    ...githubRules,
    ...rulesBeforeCnGeo,
    gfwProxyRule,
    ...rulesAfterCnGeo,
    `MATCH,${OTHERS_GROUP}`
  ];

  // 注入 GFW 规则集（MetaCubeX meta-rules-dat，与订阅自带 rule-providers 同源）。
  // 键名固定，重复执行覆写时覆盖同键，保持幂等。
  const ruleProviders = {
    ...(config["rule-providers"] &&
    typeof config["rule-providers"] === "object"
      ? config["rule-providers"]
      : {})
  };

  // 旧版本曾以 "gfw" 为键注入同一份规则集，升级后清掉，避免留下孤儿 provider。
  const legacyGfw = ruleProviders[LEGACY_GFW_RULE_PROVIDER_NAME];
  if (
    legacyGfw &&
    typeof legacyGfw === "object" &&
    legacyGfw.url === GFW_RULE_PROVIDER_URL
  ) {
    delete ruleProviders[LEGACY_GFW_RULE_PROVIDER_NAME];
  }

  ruleProviders[GFW_RULE_PROVIDER_NAME] = {
    type: "http",
    behavior: "domain",
    format: "mrs",
    interval: 86400,
    path: `./ruleset/${GFW_RULE_PROVIDER_NAME}.mrs`,
    url: GFW_RULE_PROVIDER_URL
  };

  // 判断规则集地址是否属于需要经代理下载的站点。
  function needsProxyForRuleProvider(url) {
    if (typeof url !== "string") return false;

    const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
    if (!match) return false;

    const host = match[1]
      .split("@")
      .pop()
      .split(":")[0]
      .toLowerCase();

    return RULE_PROVIDER_PROXY_HOSTS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  }

  // 只把 github / jsdelivr 等国内直连不稳定的规则集改为经 🚀 Proxies 下载：
  // 全部强制走代理会让国内镜像规则集在代理不可用时一起加载失败。
  for (const provider of Object.values(ruleProviders)) {
    if (!provider || typeof provider !== "object") continue;
    if (provider.type !== "http") continue;

    // 订阅已指定 proxy 时尊重原设置，但若指向已被删除的原分组，改写为保留策略。
    if (typeof provider.proxy === "string" && provider.proxy) {
      const target = provider.proxy;
      if (builtinWrapperByName.has(target)) {
        provider.proxy = builtinWrapperByName.get(target);
      } else if (
        originalGroupNames.has(target) &&
        !relayGroupNames.has(target) &&
        !auxGroupNames.has(target)
      ) {
        provider.proxy = NODE_GROUP;
      }
      continue;
    }

    if (!needsProxyForRuleProvider(provider.url)) continue;

    provider.proxy = NODE_GROUP;
  }

  config["rule-providers"] = ruleProviders;

  // ========================
  // 七、通用性能与持久化优化
  // ========================

  // 部分订阅会为代理集合指定 proxy；若它指向已被删除的原分组，
  // 改写为保留策略，避免 provider 下载时引用悬空。
  for (const provider of Object.values(providers)) {
    if (!provider || typeof provider !== "object") continue;
    if (typeof provider.proxy !== "string" || !provider.proxy) continue;

    const target = provider.proxy;
    if (builtinWrapperByName.has(target)) {
      provider.proxy = builtinWrapperByName.get(target);
    } else if (
      originalGroupNames.has(target) &&
      !relayGroupNames.has(target) &&
      !auxGroupNames.has(target)
    ) {
      provider.proxy = NODE_GROUP;
    }
  }

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
