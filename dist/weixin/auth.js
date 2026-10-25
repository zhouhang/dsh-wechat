/**
 * WeChat QR login flow + token persistence.
 * Ported from wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 */
import fs from "node:fs";
import path from "node:path";
import { getBotQrcode, getQrcodeStatus } from "./api.js";
import { ensurePrivateDir, writePrivateFile } from "../utils/secure-fs.js";
/**
 * A login state the user has to resolve in WeChat (already bound, verification
 * code, too many wrong codes). Retrying automatically would only spin on the
 * same answer, so the bridge surfaces the message instead of re-arming a QR.
 */
export class LoginBlockedError extends Error {
    constructor(message) {
        super(message);
        this.name = "LoginBlockedError";
    }
}
function getAuthDir(storageDir) {
    return path.join(storageDir, "auth");
}
function getTokenPath(storageDir) {
    return path.join(getAuthDir(storageDir), "token.json");
}
export function loadToken(storageDir) {
    const tokenPath = getTokenPath(storageDir);
    if (!fs.existsSync(tokenPath))
        return null;
    try {
        return JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    }
    catch {
        return null;
    }
}
export function saveToken(storageDir, data) {
    const authDir = getAuthDir(storageDir);
    ensurePrivateDir(authDir);
    const tokenPath = getTokenPath(storageDir);
    // 0o600 (dir 0o700): this file IS the bot credential — anyone who can read
    // it can send messages as the bot. On Windows Node ignores the mode and the
    // inherited `%USERPROFILE%` ACLs apply (see src/utils/secure-fs.ts).
    writePrivateFile(tokenPath, JSON.stringify(data, null, 2));
}
export async function login(params) {
    const { baseUrl, botType, storageDir, log, renderQrUrl } = params;
    log("Starting WeChat QR login...");
    const qrResp = await getBotQrcode({ baseUrl, botType });
    const qrcodeUrl = qrResp.qrcode_img_content;
    log("Please scan the QR code with WeChat:");
    if (renderQrUrl) {
        renderQrUrl(qrcodeUrl);
    }
    else {
        log(`QR URL: ${qrcodeUrl}`);
    }
    // The QR flow must outlive a slow install: opening WeChat, finding the
    // plugin, and confirming can take minutes, and each QR only lives ~5
    // minutes. Thirty minutes with automatic QR refresh means the page a user
    // opened after install still has a scannable code. The bridge retries the
    // whole flow on timeout, so this is a safety net, not the normal exit.
    const deadline = Date.now() + 30 * 60_000;
    let currentQrcode = qrResp.qrcode;
    let currentBaseUrl = baseUrl;
    let refreshCount = 0;
    let lastStatus = "";
    while (Date.now() < deadline) {
        const statusResp = await getQrcodeStatus({ baseUrl: currentBaseUrl, qrcode: currentQrcode });
        if (statusResp.status !== lastStatus) {
            lastStatus = statusResp.status;
            log(`QR status: ${lastStatus}`);
        }
        switch (statusResp.status) {
            case "wait":
                break;
            case "scaned":
                log("QR scanned, please confirm in WeChat...");
                break;
            case "scaned_but_redirect": {
                // The account's bot lives on another IDC; keep polling there instead of
                // treating the status as "wait" forever.
                const host = statusResp.redirect_host;
                if (host) {
                    currentBaseUrl = `https://${host}`;
                    log(`IDC redirect, polling ${currentBaseUrl}`);
                }
                break;
            }
            case "binded_redirect":
                throw new LoginBlockedError("这个微信号已经绑定过一个微信 ClawBot。请先在微信「我 → 设置 → 插件 → 微信 ClawBot」里断开旧连接，再回来重新扫码。");
            case "need_verifycode":
                throw new LoginBlockedError("这次登录需要输入手机微信里显示的数字验证码，当前插件还不支持输入。请重试，或在微信里重新发起连接。");
            case "verify_code_blocked":
                throw new LoginBlockedError("验证码错误次数过多，微信暂时拦截了这次连接。请稍后再试。");
            case "expired": {
                refreshCount++;
                if (refreshCount > 30) {
                    throw new Error("QR code expired multiple times, please retry");
                }
                log(`QR expired, refreshing (${refreshCount}/30)...`);
                const newQr = await getBotQrcode({ baseUrl: currentBaseUrl, botType });
                currentQrcode = newQr.qrcode;
                if (renderQrUrl) {
                    renderQrUrl(newQr.qrcode_img_content);
                }
                else {
                    log(`New QR URL: ${newQr.qrcode_img_content}`);
                }
                break;
            }
            case "confirmed": {
                log("Login successful!");
                const tokenData = {
                    token: statusResp.bot_token,
                    baseUrl: statusResp.baseurl || baseUrl,
                    accountId: statusResp.ilink_bot_id,
                    userId: statusResp.ilink_user_id,
                    savedAt: new Date().toISOString(),
                };
                saveToken(storageDir, tokenData);
                log(`Bot ID: ${tokenData.accountId}`);
                log(`Token saved to ${getTokenPath(storageDir)}`);
                return tokenData;
            }
        }
        await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`Login timeout (30 minutes, last status: ${lastStatus || "none"})`);
}
//# sourceMappingURL=auth.js.map