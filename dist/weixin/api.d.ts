/**
 * WeChat iLink HTTP API client.
 * Adapted from @tencent-weixin/openclaw-weixin api/api.ts and
 * wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 */
import type { GetUpdatesResp, SendMessageReq, GetUploadUrlReq, GetUploadUrlResp, SendTypingReq, GetConfigResp } from "./types.js";
import { isRetryableNetworkError } from "../utils/network.js";
export { isRetryableNetworkError };
/**
 * Thrown when the iLink gateway returns a parseable session-timeout body
 * (`errcode` / `ret` === -14). Distinct from the undici content-length
 * shape: that one never yields a JSON body at all.
 */
export declare class SessionTimeoutError extends Error {
    readonly code = "SESSION_TIMEOUT";
    constructor(message?: string);
}
/** A parseable iLink business rejection returned inside an HTTP 200 body. */
export declare class IlinkApiError extends Error {
    readonly endpoint: string;
    readonly ret: number | undefined;
    readonly errcode: number | undefined;
    readonly errmsg: string | undefined;
    readonly code = "ILINK_API_ERROR";
    constructor(endpoint: string, ret: number | undefined, errcode: number | undefined, errmsg: string | undefined);
}
/**
 * True for the real continuous-send-limit response observed from iLink:
 * HTTP 200 + { ret: -2, errmsg: "prepare failed" }.
 */
export declare function isMessageLimitError(err: unknown): boolean;
/**
 * True for a rejected send payload (`ret=-1` / "invalid request").
 * Unlike rate-limit or -14, retrying the same body will not succeed.
 */
export declare function isInvalidRequestError(err: unknown): boolean;
/** True when a parsed iLink JSON body reports session timeout. */
export declare function isSessionTimeoutApiBody(value: unknown): boolean;
/**
 * Detect undici's `InvalidArgumentError: invalid content-length header`.
 *
 * The iLink gateway returns HTTP 200 with body
 * `{"errcode":-14,"errmsg":"session timeout"}` when a session is no longer
 * valid, but it ships a malformed `Content-Length` header alongside it. undici
 * refuses to parse such a response and throws this error before we can ever
 * see the JSON, so the real reason is buried under "fetch failed: …". Walking
 * the cause chain lets callers classify the error whether fetch wrapped it
 * (the typical case) or surfaced it directly.
 */
export declare function isSessionTimeoutContentLengthError(err: unknown): boolean;
/** Session timeout whether it arrived as JSON `-14` or the undici header fault. */
export declare function isSessionTimeoutError(err: unknown): boolean;
export interface ApiPostOptions {
    /** How many retries to attempt on transient network failures. Default: 2. */
    retries?: number;
    /** Base delay in ms for exponential backoff. Default: 1000 (so 1s, 2s, 4s, ...). */
    baseDelayMs?: number;
    /**
     * Optional external abort signal — when aborted, the current fetch
     * rejects immediately.
     */
    abortSignal?: AbortSignal;
}
export declare function getUpdates(params: {
    baseUrl: string;
    token?: string;
    get_updates_buf: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
}): Promise<GetUpdatesResp>;
export declare function sendMessage(params: {
    baseUrl: string;
    token?: string;
    body: SendMessageReq;
    retries?: number;
}): Promise<void>;
export declare function getUploadUrl(params: {
    baseUrl: string;
    token?: string;
    body: GetUploadUrlReq;
}): Promise<GetUploadUrlResp>;
export declare function getConfig(params: {
    baseUrl: string;
    token?: string;
    ilinkUserId: string;
    contextToken?: string;
}): Promise<GetConfigResp>;
export declare function sendTyping(params: {
    baseUrl: string;
    token?: string;
    body: SendTypingReq;
}): Promise<void>;
export declare function getBotQrcode(params: {
    baseUrl: string;
    botType?: string;
}): Promise<{
    qrcode: string;
    qrcode_img_content: string;
}>;
export declare function getQrcodeStatus(params: {
    baseUrl: string;
    qrcode: string;
}): Promise<{
    status: string;
    bot_token?: string;
    baseurl?: string;
    ilink_bot_id?: string;
    ilink_user_id?: string;
    /** IDC host to poll instead, when status is `scaned_but_redirect`. */
    redirect_host?: string;
}>;
/**
 * Notify iLink that this channel client is starting (gateway startup /
 * channel start, and the `-14` recovery path).
 *
 * Used by the monitor loop to rebuild a dead server-side session before
 * retrying `getUpdates`. On success the existing long-poll token is
 * typically still valid; on failure we back off and try again. Mirrors
 * `ilink/bot/msg/notifystart` from upstream `@tencent-weixin/openclaw-weixin`.
 */
export declare function notifyStart(params: {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
}): Promise<void>;
/**
 * Notify iLink that this channel client is stopping. Symmetric counterpart
 * to `notifyStart`; not used by the current monitor but kept for parity
 * with upstream and for any future graceful-shutdown path.
 */
export declare function notifyStop(params: {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
}): Promise<void>;
//# sourceMappingURL=api.d.ts.map