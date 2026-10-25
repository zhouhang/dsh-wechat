/**
 * dsh-wechat — Bridge WeChat (iLink bot) to DeepSeek Harness (DSH).
 *
 * Cordis host plugin entry. Loaded through the package's cordis.patch.yml
 * bundle layer (`- insert: - id: dsh-wechat name: 'dsh-wechat'`).
 *
 * Zero runtime dependencies on `@deepseek-ai/*` packages: every DSH
 * service is read through `ctx.get(...)` and all message/value types are
 * constructed by local vendors or structural shapes.
 */
import { sessionIdFrom } from "./surface-prompt.js";
export { sessionIdFrom };
export declare const name = "dsh-wechat";
export declare const inject: string[];
/** Plugin config accepted from the composition row's `config:` block. */
export interface PluginConfig {
    baseUrl?: string;
    cdnBaseUrl?: string;
    botType?: string;
    storageDir?: string;
    cwd?: string;
    textChunkLimit?: number;
    cardTimeoutMs?: number;
    silent?: boolean;
    finalOnly?: boolean;
    finalOnlyIdleMs?: number;
    finalOnlyCeilingMs?: number;
    surfacePromptEnabled?: boolean;
    surfacePrompt?: string;
    allowRemotePermissionEscalation?: boolean;
    allowAnyFilePath?: boolean;
    maxOutgoingFileBytes?: number;
    mergeEnabled?: boolean;
    mergeSilenceMs?: number;
    mergeMaxMsgs?: number;
    mergeSuffixTokens?: boolean;
    mergeForcedReleaseMs?: number;
    mediaMergeEnabled?: boolean;
    mediaHoldMs?: number;
    mediaAtRefEnabled?: boolean;
}
export declare function apply(ctx: unknown, rawConfig?: PluginConfig): () => Promise<void>;
//# sourceMappingURL=index.d.ts.map