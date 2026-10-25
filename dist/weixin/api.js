/**
 * WeChat iLink HTTP API client.
 * Adapted from @tencent-weixin/openclaw-weixin api/api.ts and
 * wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 */
import crypto from "node:crypto";
import { isRetryableNetworkError } from "../utils/network.js";
const CHANNEL_VERSION = "1.0.2";
export { isRetryableNetworkError };
const SESSION_EXPIRED_ERRCODE = -14;
/**
 * Thrown when the iLink gateway returns a parseable session-timeout body
 * (`errcode` / `ret` === -14). Distinct from the undici content-length
 * shape: that one never yields a JSON body at all.
 */
export class SessionTimeoutError extends Error {
    code = "SESSION_TIMEOUT";
    constructor(message = "session timeout") {
        super(message);
        this.name = "SessionTimeoutError";
    }
}
/** A parseable iLink business rejection returned inside an HTTP 200 body. */
export class IlinkApiError extends Error {
    endpoint;
    ret;
    errcode;
    errmsg;
    code = "ILINK_API_ERROR";
    constructor(endpoint, ret, errcode, errmsg) {
        const status = ret !== undefined ? `ret=${ret}` : `errcode=${errcode}`;
        super(`${endpoint}: ${status}${errmsg ? ` ${errmsg}` : ""}`);
        this.endpoint = endpoint;
        this.ret = ret;
        this.errcode = errcode;
        this.errmsg = errmsg;
        this.name = "IlinkApiError";
    }
}
/**
 * True for the real continuous-send-limit response observed from iLink:
 * HTTP 200 + { ret: -2, errmsg: "prepare failed" }.
 */
export function isMessageLimitError(err) {
    if (!err || typeof err !== "object")
        return false;
    const value = err;
    return (value.name === "IlinkApiError" &&
        (value.ret === -2 || value.errcode === -2) &&
        typeof value.errmsg === "string" &&
        value.errmsg.trim().toLowerCase() === "prepare failed");
}
/**
 * True for a rejected send payload (`ret=-1` / "invalid request").
 * Unlike rate-limit or -14, retrying the same body will not succeed.
 */
export function isInvalidRequestError(err) {
    if (!err || typeof err !== "object")
        return false;
    const value = err;
    if (value.name !== "IlinkApiError")
        return false;
    if (value.ret === -1 || value.errcode === -1)
        return true;
    return typeof value.errmsg === "string" && /invalid request/i.test(value.errmsg);
}
/** Validate only sendmessage business status; other endpoints keep their own contracts. */
function assertSendMessageAccepted(resp) {
    if (isSessionTimeoutApiBody(resp)) {
        throw new SessionTimeoutError(resp.errmsg || "session timeout");
    }
    const rejected = (typeof resp.ret === "number" && resp.ret !== 0) ||
        (typeof resp.errcode === "number" && resp.errcode !== 0);
    if (rejected) {
        throw new IlinkApiError("ilink/bot/sendmessage", resp.ret, resp.errcode, resp.errmsg);
    }
}
/** True when a parsed iLink JSON body reports session timeout. */
export function isSessionTimeoutApiBody(value) {
    if (!value || typeof value !== "object")
        return false;
    const obj = value;
    return obj.errcode === SESSION_EXPIRED_ERRCODE || obj.ret === SESSION_EXPIRED_ERRCODE;
}
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
export function isSessionTimeoutContentLengthError(err) {
    if (!err || typeof err !== "object")
        return false;
    let current = err;
    const seen = new Set();
    while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        const obj = current;
        const isInvalidArg = obj.name === "InvalidArgumentError" || obj.code === "UND_ERR_INVALID_ARG";
        if (isInvalidArg &&
            typeof obj.message === "string" &&
            /content-length/i.test(obj.message)) {
            return true;
        }
        current = obj.cause;
    }
    return false;
}
/** Session timeout whether it arrived as JSON `-14` or the undici header fault. */
export function isSessionTimeoutError(err) {
    if (isSessionTimeoutContentLengthError(err))
        return true;
    if (!err || typeof err !== "object")
        return false;
    const obj = err;
    return obj.name === "SessionTimeoutError" || obj.code === "SESSION_TIMEOUT";
}
function randomWechatUin() {
    const uint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32), "utf-8").toString("base64");
}
function buildHeaders(opts) {
    const headers = {
        "Content-Type": "application/json",
        AuthorizationType: "ilink_bot_token",
        "X-WECHAT-UIN": randomWechatUin(),
    };
    if (opts.token?.trim()) {
        headers["Authorization"] = `Bearer ${opts.token.trim()}`;
    }
    return headers;
}
function buildBaseInfo() {
    return { channel_version: CHANNEL_VERSION };
}
async function apiGet(baseUrl, path, token) {
    const url = `${baseUrl.replace(/\/$/, "")}/${path}`;
    const res = await fetch(url, { headers: buildHeaders({ token }) });
    const text = await res.text();
    if (!res.ok)
        throw new Error(`HTTP ${res.status}: ${text}`);
    return JSON.parse(text);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function apiPost(baseUrl, endpoint, body, token, timeoutMs = 15_000, options) {
    const url = `${baseUrl.replace(/\/$/, "")}/${endpoint}`;
    const payload = { ...body, base_info: buildBaseInfo() };
    const bodyStr = JSON.stringify(payload);
    const retries = options?.retries ?? 2;
    const baseDelayMs = options?.baseDelayMs ?? 1000;
    const maxAttempts = retries + 1;
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let externalAbortListener;
        if (options?.abortSignal) {
            if (options.abortSignal.aborted) {
                controller.abort();
            }
            else {
                externalAbortListener = () => controller.abort();
                options.abortSignal.addEventListener("abort", externalAbortListener, { once: true });
            }
        }
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: buildHeaders({ token }),
                body: bodyStr,
                signal: controller.signal,
            });
            clearTimeout(timer);
            const text = await res.text();
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${text}`);
            }
            const parsed = (text.trim() ? JSON.parse(text) : {});
            if (isSessionTimeoutApiBody(parsed)) {
                const errmsg = parsed && typeof parsed === "object" && "errmsg" in parsed && typeof parsed.errmsg === "string"
                    ? parsed.errmsg
                    : "session timeout";
                throw new SessionTimeoutError(errmsg);
            }
            return parsed;
        }
        catch (err) {
            clearTimeout(timer);
            // AbortError sentinel: getUpdates long-poll timed out, no messages.
            if (err.name === "AbortError") {
                return { ret: 0, msgs: [] };
            }
            // Session timeout (-14): either a parseable JSON body we just threw
            // as SessionTimeoutError, or undici's InvalidArgumentError from a
            // malformed Content-Length. Skip retries — the token is rejected
            // server-side; hammering the endpoint just spams the log.
            if (isSessionTimeoutError(err)) {
                lastError = err;
                break;
            }
            lastError = err;
            const isLastAttempt = attempt >= retries;
            if (isLastAttempt || !isRetryableNetworkError(err)) {
                break;
            }
            const delayMs = baseDelayMs * Math.pow(2, attempt);
            // eslint-disable-next-line no-console
            console.error(`apiPost ${endpoint} failed (attempt ${attempt + 1}/${maxAttempts}), ` +
                `retrying in ${delayMs}ms: ${String(err)}`);
            await sleep(delayMs);
        }
        finally {
            if (externalAbortListener && options?.abortSignal) {
                options.abortSignal.removeEventListener("abort", externalAbortListener);
            }
        }
    }
    const cause = lastError?.cause;
    if (cause !== undefined) {
        const wrapped = new Error(`${lastError.message}: ${String(cause)}`);
        wrapped.cause = cause;
        throw wrapped;
    }
    throw lastError;
}
export async function getUpdates(params) {
    // Long-poll: do NOT retry on transient network errors here — the
    // monitor loop already has its own retry/backoff.
    return apiPost(params.baseUrl, "ilink/bot/getupdates", { get_updates_buf: params.get_updates_buf }, params.token, params.timeoutMs ?? 38_000, { retries: 0, abortSignal: params.abortSignal });
}
export async function sendMessage(params) {
    const resp = await apiPost(params.baseUrl, "ilink/bot/sendmessage", params.body, params.token, undefined, { retries: params.retries ?? 2 });
    assertSendMessageAccepted(resp);
}
export async function getUploadUrl(params) {
    return apiPost(params.baseUrl, "ilink/bot/getuploadurl", params.body, params.token);
}
export async function getConfig(params) {
    return apiPost(params.baseUrl, "ilink/bot/getconfig", {
        ilink_user_id: params.ilinkUserId,
        ...(params.contextToken ? { context_token: params.contextToken } : {}),
    }, params.token, 10_000);
}
export async function sendTyping(params) {
    await apiPost(params.baseUrl, "ilink/bot/sendtyping", params.body, params.token, 10_000);
}
export async function getBotQrcode(params) {
    return apiGet(params.baseUrl, `ilink/bot/get_bot_qrcode?bot_type=${params.botType ?? "3"}`);
}
export async function getQrcodeStatus(params) {
    return apiGet(params.baseUrl, `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`);
}
/**
 * Notify iLink that this channel client is starting (gateway startup /
 * channel start, and the `-14` recovery path).
 *
 * Used by the monitor loop to rebuild a dead server-side session before
 * retrying `getUpdates`. On success the existing long-poll token is
 * typically still valid; on failure we back off and try again. Mirrors
 * `ilink/bot/msg/notifystart` from upstream `@tencent-weixin/openclaw-weixin`.
 */
export async function notifyStart(params) {
    await apiPost(params.baseUrl, "ilink/bot/msg/notifystart", { base_info: buildBaseInfo() }, params.token, params.timeoutMs ?? 10_000, { abortSignal: params.abortSignal });
}
/**
 * Notify iLink that this channel client is stopping. Symmetric counterpart
 * to `notifyStart`; not used by the current monitor but kept for parity
 * with upstream and for any future graceful-shutdown path.
 */
export async function notifyStop(params) {
    await apiPost(params.baseUrl, "ilink/bot/msg/notifystop", { base_info: buildBaseInfo() }, params.token, params.timeoutMs ?? 10_000, { abortSignal: params.abortSignal });
}
//# sourceMappingURL=api.js.map