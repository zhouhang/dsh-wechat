/**
 * WeChat long-poll monitor loop.
 * Polls getUpdates, dispatches messages via callback.
 * Ported from wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 */
import type { WeixinMessage } from "./types.js";
export interface MonitorOpts {
    baseUrl: string;
    token?: string;
    storageDir: string;
    abortSignal?: AbortSignal;
    longPollTimeoutMs?: number;
    log: (msg: string) => void;
    onMessage: (msg: WeixinMessage) => void;
    /** Gateway rejected the bot session (`-14`). Outbound should park. */
    onSessionInvalid?: () => void;
    /** A subsequent getUpdates succeeded; outbound may resume and flush. */
    onSessionRecovered?: () => void;
    /**
     * notifyStart failed enough times that the user should re-scan.
     * Fired once when the hint threshold is first crossed.
     */
    onSessionGiveUp?: () => void;
}
/** Drop the long-poll cursor so a new bot session does not resume the old one. */
export declare function clearSyncBuf(storageDir: string): void;
export declare function startMonitor(opts: MonitorOpts): Promise<void>;
//# sourceMappingURL=monitor.d.ts.map