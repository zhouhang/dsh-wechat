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