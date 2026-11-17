# AGENTS.md

本文件供 AI 编程代理阅读，帮助其快速理解本项目。

## 项目概览

本项目是一个单文件项目，仓库内唯一的代码文件是 `overwrite.js`。它是 Clash Verge Rev 与 Mihomo Party 通用的「脚本覆写」（JavaScript 覆写脚本），导出一个 `function main(config)` 函数：订阅的原始 YAML 配置被解析为对象后传入，函数原地修改并返回该对象，覆写结果作为最终生效的 Mihomo 内核配置。

主要功能：

- 强制将策略组精简为四个：`🚀 Proxies`（select，全部节点）、`🇺🇸 US`（select，按名称正则筛选美国节点）、`🔄 Fallback`（fallback，自动切换健康节点）、`🐟 Others`（select，未命中规则的兜底出口，成员为 DIRECT、`🚀 Proxies` 与全部节点，选中 `🚀 Proxies` 即兜底跟随节点选择）。不自定义 `GLOBAL` 分组，由 Mihomo 内置 GLOBAL 兜底。
- 前置/中转/跳板分组（按名称正则 `RELAY_GROUP_REGEX` 或节点 `dialer-proxy` 引用识别）不删除，改建为 `url-test`（`hidden: true` 隐藏）附在四个固定分组之后，由内核自动选择延迟最低的前置节点；前置节点仅作入口，从四个固定出口分组的成员中排除。前置分组必须保留：出口节点的 `dialer-proxy` 引用它，删除会导致配置失效。测速地址沿用原分组配置，缺省用国内可达的 `RELAY_HEALTH_CHECK_URL`（中转节点在国内，用 gstatic 会被全部误判失败）；成员中纯内置策略及其包装组（如「关闭」→DIRECT）会被剔除。前置分组引用到的其他分组递归保留并隐藏。
- 仅包装内置策略的分组（如「拦截」→[REJECT]、「不拦截」→[PASS]，含成员全是此类分组的开关组如「🛑 广告拦截」）会被删除，规则引用改写为解析出的内置策略（多个内置策略时按 REJECT > REJECT-DROP > PASS > DIRECT 优先）。
- 为所有 proxy-provider 强制开启健康检查。
- 重写路由规则中引用已删除策略组的策略名（兼容 `SUB-RULE` 与 `no-resolve` 后缀），删除旧 `MATCH` 规则并在末尾统一追加 `MATCH,🐟 Others`。
- 在中国大陆 AI 产品主站（DeepSeek、Kimi、豆包等）置顶 DIRECT 分流规则；ChatGPT/OpenAI 域名走 `🇺🇸 US`；常用测速网站与常用国外网站（`FOREIGN_COMMON_DOMAINS`：Google、YouTube、X、GitHub 等）走 `🚀 Proxies`。
- 注入 GFW 规则集（rule-provider `gfw`，引用活跃维护的 MetaCubeX meta-rules-dat `geosite/gfw.mrs`，`RULE-SET` 规则位于订阅规则之后、`MATCH` 之前），被墙网站统一走 `🚀 Proxies`；覆写保留订阅自带的 rule-providers，注入键固定以保证幂等。
- 开启 `unified-delay`、`tcp-concurrent` 和策略选择持久化（`profile.store-selected` / `store-fake-ip`）。

## 技术栈与运行时

- 语言：JavaScript（ES2015+，使用 `const`、箭头函数、`Set`、`Map`、`Object.fromEntries` 等）。
- 无构建步骤、无依赖、无 `package.json`、无测试框架。
- 运行时由 Clash Verge Rev / Mihomo Party 的覆写功能提供：脚本被宿主应用加载执行，宿主调用 `main(config)`。脚本必须保持「导出顶层 `main(config)` 函数并返回 config」的签名不变。
- 编辑建议：仓库采用 Git 管理；`.history/` 目录为编辑器本地历史插件产物，与项目无关，不要修改。

## 代码组织

`overwrite.js` 单文件按注释编号分为七个部分：

1. 一、用户可调参数：策略组名称常量、`MANUAL_AIRPORT_GROUP`（机场总策略组手动指定）、`ENABLE_IPV6`、健康检查参数、中国大陆 AI 域名列表、美国节点识别正则、前置分组识别正则 `RELAY_GROUP_REGEX`、前置分组默认测速地址 `RELAY_HEALTH_CHECK_URL` 与 `RELAY_URL_TEST_TOLERANCE`。
2. 二、读取原始配置：解析 rules、proxies、proxy-groups、proxy-providers。
3. 三、为 provider 开启健康检查。
4. 四、识别机场原策略组（`detectAirportGroup`，含递归统计可达节点 `collectReachableNodes`）。
5. 五、创建四个策略组并覆写 `config["proxy-groups"]`。
6. 六、重写规则策略引用并追加专用分流规则（`config.rules` 只在此处统一写入一次，勿拆分赋值）。
7. 七、通用性能与持久化优化（含 `config.ipv6`，**不覆写 `config.dns`**，DNS 完全沿用订阅或客户端默认配置）。

## 开发与测试约定

- 注释与文档使用中文，新增注释应保持中文。
- 代码风格：2 空格缩进，函数与常量集中定义在所属章节内；策略名、域名等可配置项集中在第一部分的用户可调参数区。
- 没有自动化测试。验证方式：修改后在 Clash Verge Rev / Mihomo Party 中实际加载该覆写脚本，检查生成配置中策略组数量、规则顺序（专用规则在前、`MATCH,🐟 Others` 收尾）是否符合预期。
- 幂等性是重要约定：脚本对同一份已覆写配置重复执行必须得到相同结果（识别原策略组时已排除自身创建的四个组）。修改时不得破坏幂等性。
- 双写注意：美国节点识别存在两份表达式——JS 正则 `US_NODE_REGEX` 与 RE2 字符串 `US_PROVIDER_FILTER`（provider filter 用），修改时须同步。

## 安全注意事项

- 脚本不覆写 `config.dns`，DNS 行为由订阅原始配置或客户端默认决定；如未来恢复 DNS 覆写，监听地址必须固定在本机回环，不要向局域网暴露 DNS 服务。
- 脚本不读取环境变量、文件系统或网络，无密钥、无外部请求；请保持这一性质，不要引入网络请求或敏感信息。
- 中国 AI 域名列表刻意只列产品专用域名，避免 `baidu.com`、`qq.com` 等过宽规则导致误直连；新增域名时遵循同一原则。
