/**
 * Send messages via WeChat iLink API.
 * Ported from wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 */
export interface WeixinSendOpts {
    baseUrl: string;
    token?: string;
    contextToken?: string;
    /**
     * Number of retries on transient network failures for the underlying
     * `sendMessage` API call. Default: 2 (3 total attempts). Set to 0 to
     * disable retry for paths that are already best-effort.
     */
    retries?: number;
}
export declare function sendTextMessage(to: string, text: string, opts: WeixinSendOpts): Promise<string>;
export interface SendMediaOpts extends WeixinSendOpts {
    cdnBaseUrl: string;
    fileName?: string;
    mimeType?: string;
    thumbBuffer?: Buffer;
}
/**
 * Send a media message (image/file/video/voice) to a WeChat user.
 *
 * Flow:
 * 1. Generate 16-byte AES key
 * 2. Call getUploadUrl with AES key (server encrypts upload_param with it)
 * 3. Encrypt file content with AES-128-ECB
 * 4. Upload encrypted content to CDN using server-returned upload_param
 * 5. Send message with CDN media reference
 */
export declare function sendMediaMessage(to: string, mediaType: 1 | 2 | 3 | 4, // IMAGE=1, VIDEO=2, FILE=3, VOICE=4
buffer: Buffer, opts: SendMediaOpts): Promise<string>;
/**
 * Replace unpaired UTF-16 surrogates. iLink `sendmessage` rejects them with
 * `ret=-1 invalid request`; a truncated emoji in `/status` is the usual source.
 */
export declare function sanitizeWeChatText(text: string): string;
/**
 * Split one outbound body into WeChat-sized segments.
 *
 * The old implementation chopped at the byte-window boundary (`lastIndexOf`
 * of a newline below `maxLen`, else a hard cut). That is destructive for the
 * two constructs WeChat renders natively, because their meaning lives in
 * their delimiters:
 *
 *   - a fenced code block cut in half loses its closing fence, so the
 *     remainder renders as ordinary prose (and a stray fence swallows the
 *     rest of the message into a code block);
 *   - a GFM table cut in half loses its header + separator row, so every
 *     continuation row is an invalid table and renders as raw pipes.
 *
 * So fences and tables are atomic units: never cut inside one. When a unit
 * alone exceeds the budget it is split while repeating its own delimiters —
 * the fence line for a code block, header + separator for a table — so each
 * segment is still independently valid markdown.
 *
 * Break preference inside plain prose: blank line, then newline, then space,
 * then a hard cut. A candidate break is only accepted at ≥55% of the budget,
 * otherwise a single early newline would emit a two-word first chunk and
 * spend one of WeChat's ten messages on it.
 *
 * The budget counts CODE POINTS, not UTF-16 units: an emoji costs 2 units but
 * occupies one WeChat character cell, so unit-counting under-fills every
 * message that contains emoji. When the text needs more than one segment each
 * one is prefixed `（i/n）`, and that prefix is charged to the same budget —
 * otherwise the prefix is what pushes a "full" segment over the limit.
 *
 * @param text - the message body (already markdown-formatted for WeChat).
 * @param maxLen - per-segment budget in code points.
 * @returns one or more segments; a single segment is returned unprefixed.
 */
export declare function splitText(text: string, maxLen: number): string[];
//# sourceMappingURL=send.d.ts.map