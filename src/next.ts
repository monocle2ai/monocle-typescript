// Next.js config helper. Bundling the Monocle chain or the hooked packages
// breaks instrumentation (no module boundary to hook), so keep them external.
//   import { withMonocle } from "monocle2ai/next";
//   export default withMonocle(nextConfig, { externalPackages: ["@mastra/core"] });

// The Monocle instrumentation chain — never bundle these.
const MONOCLE_PACKAGES = [
    "monocle2ai",
    "import-in-the-middle",
    "require-in-the-middle",
    "module-details-from-path",
    "resolve",
];

// Chain bare names + their subpaths (serverExternalPackages misses subpaths like
// import-in-the-middle/hook.mjs).
const MONOCLE_SUBPATH_RE =
    /^(monocle2ai|import-in-the-middle|require-in-the-middle|module-details-from-path|resolve)(\/|$)/;

// Backend SDKs Monocle instruments that are safe to externalize by default
// (an absent one is a no-op). Excludes framework-coupled libs (see below).
export const MONOCLE_INSTRUMENTED_PACKAGES = [
    "@mastra/core",
    "openai",
    "@anthropic-ai/sdk",
    "@google/genai",
    "@google/adk",
    // agents-core is where Runner lives; the browser-facing realtime package is
    // not instrumented.
    "@openai/agents-core",
    "@langchain/core",
    "llamaindex",
    "@llamaindex/workflow",
    "@llamaindex/openai",
    "@aws-sdk/client-bedrock-runtime",
    "@aws-sdk/client-sagemaker-runtime",
    "@modelcontextprotocol/sdk",
    "@a2a-js/sdk",
    "@opensearch-project/opensearch",
    "@microsoft/teams-ai",
];

// Instrumented but framework-coupled (client/RSC) — can break when externalized,
// so excluded from the default. Opt in via `externalPackages`. The sync test
// (test/unit/nextExternals.test.ts) uses this to account for every package.
export const FRAMEWORK_COUPLED_PACKAGES = [
    "ai", // Vercel AI SDK (ai/rsc, client streaming)
];

export interface WithMonocleOptions {
    // Extra instrumented packages to externalize (e.g. "@mastra/ai-sdk", or "ai").
    externalPackages?: string[];
    // false → skip the curated defaults; externalize only the chain + your extras.
    includeInstrumentedDefaults?: boolean;
}

export function withMonocle(nextConfig: any = {}, options: WithMonocleOptions = {}): any {
    const extra = options.externalPackages ?? [];
    const defaults = options.includeInstrumentedDefaults === false ? [] : MONOCLE_INSTRUMENTED_PACKAGES;
    const serverExternalPackages = Array.from(
        new Set([
            ...(nextConfig.serverExternalPackages ?? []),
            ...MONOCLE_PACKAGES,
            ...defaults,
            ...extra,
        ]),
    );

    const userWebpack = nextConfig.webpack;

    return {
        ...nextConfig,
        serverExternalPackages,
        webpack(config: any, ctx: any) {
            // Preserve any user-provided webpack hook.
            if (typeof userWebpack === "function") {
                config = userWebpack(config, ctx) ?? config;
            }
            if (ctx && ctx.isServer) {
                config.externals = config.externals || [];
                config.externals.push(
                    ({ request }: { request?: string }, cb: (err?: any, result?: string) => void) => {
                        if (request && MONOCLE_SUBPATH_RE.test(request)) {
                            return cb(undefined, `commonjs ${request}`);
                        }
                        cb();
                    },
                );
            }
            return config;
        },
    };
}
