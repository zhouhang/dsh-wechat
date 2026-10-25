/**
 * WeChat QR login flow + token persistence.
 * Ported from wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 */
export interface TokenData {
    token: string;
    baseUrl: string;
    accountId: string;
    userId: string;
    savedAt: string;
}
/**
 * A login state the user has to resolve in WeChat (already bound, verification
 * code, too many wrong codes). Retrying automatically would only spin on the
 * same answer, so the bridge surfaces the message instead of re-arming a QR.
 */
export declare class LoginBlockedError extends Error {
    constructor(message: string);
}
export declare function loadToken(storageDir: string): TokenData | null;
export declare function saveToken(storageDir: string, data: TokenData): void;
export declare function login(params: {
    baseUrl: string;
    botType?: string;
    storageDir: string;
    log: (msg: string) => void;
    renderQrUrl?: (url: string) => void;
}): Promise<TokenData>;
//# sourceMappingURL=auth.d.ts.map