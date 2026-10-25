/**
 * AES-128-ECB encrypt/decrypt for WeChat CDN media.
 * Adapted from @tencent-weixin/openclaw-weixin cdn/aes-ecb.ts and
 * wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 */
import type { CDNMedia } from "./types.js";
export declare function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer;
export declare function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer;
/**
 * Parse the AES key from CDN media reference.
 * The key can be either:
 *   - base64 → 16 raw bytes (use directly)
 *   - base64 → 32 hex chars → parse hex → 16 bytes
 */
export declare function parseAesKey(media: CDNMedia): Buffer | null;
export declare function downloadAndDecrypt(encryptQueryParam: string, aesKey: Buffer, cdnBaseUrl: string, filekey?: string): Promise<Buffer>;
export declare function uploadToCdn(params: {
    buffer: Buffer;
    uploadParam: string;
    aesKey: Buffer;
    filekey: string;
    cdnBaseUrl: string;
    uploadUrl?: string;
}): Promise<string>;
//# sourceMappingURL=media.d.ts.map