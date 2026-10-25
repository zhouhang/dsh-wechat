/**
 * Editable WeChat configuration, persisted to `~/.dsh-wechat/config.json`.
 *
 * Merge order (later wins): built-in defaults ← composition `config:` block
 * ← config.json (edited from the Settings page).
 */
import { type WeChatDSHConfig } from "./config.js";
export type EditableConfig = Pick<WeChatDSHConfig, "baseUrl" | "cdnBaseUrl" | "botType" | "cwd" | "textChunkLimit" | "cardTimeoutMs" | "crossSessionNotify" | "notifyTaskEvents" | "silent" | "finalOnly" | "finalOnlyIdleMs" | "finalOnlyCeilingMs" | "surfacePromptEnabled" | "surfacePrompt" | "sendWechatRateLimitPerMinute" | "allowedUsers" | "allowRemotePermissionEscalation" | "allowAnyFilePath" | "maxOutgoingFileBytes" | "mergeEnabled" | "mergeSilenceMs" | "mergeMaxMsgs" | "mergeSuffixTokens" | "mergeForcedReleaseMs" | "mediaMergeEnabled" | "mediaHoldMs" | "mediaAtRefEnabled">;
export declare const EDITABLE_KEYS: Array<keyof EditableConfig>;
export declare class ConfigStore {
    private readonly filePath;
    private overrides;
    constructor(storageDir: string);
    private load;
    private save;
    /** Resolve the effective config: composition defaults overridden by stored values. */
    resolve(base: WeChatDSHConfig): WeChatDSHConfig;
    /** Apply a patch and persist it. Returns the new effective overrides. */
    update(patch: Partial<EditableConfig>): Partial<EditableConfig>;
    /** The raw stored overrides (for display in the settings page). */
    stored(): Partial<EditableConfig>;
}
//# sourceMappingURL=config-store.d.ts.map