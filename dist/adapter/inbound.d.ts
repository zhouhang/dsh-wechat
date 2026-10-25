/**
 * Inbound adapter: convert WeChat messages to DSH content blocks.
 * Ported and adapted from wechat-opencode (MIT) —
 * https://github.com/pan17/wechat-opencode (src/adapter/inbound.ts)
 */
import type { WeixinMessage, MessageItem } from "../weixin/types.js";
export interface PromptBlock {
    type: "text";
    text: string;
}
/**
 * How a saved inbound media file is announced to the model.
 *
 *   - `"at"` — a host `@文件` reference (`@path` / `@"path with spaces"`), the
 *     exact token the GUI composer produces, so the GUI renders an openable
 *     chip. `dsh-file-reference-local` installs `FILE_REFERENCE_PROMPT` for it,
 *     which tells the model to call `read`. Opt-in: the chip only appears when
 *     the host has that plugin mounted.
 *   - `"path"` (default) — the plain-path wording (`文件已保存到: <abs path>`),
 *     which reads correctly whatever the host has mounted. Same pointer,
 *     different spelling.
 *
 * NEITHER mode pastes the file's content. That is not a mode, it is the rule: a
 * file is a POINTER. Inlining the bytes duplicates what `read` returns, turns
 * the chat bubble into a wall of the file's text, and lets one large attachment
 * burn the context window. (0.12 and earlier did paste small text files; 0.13.0
 * removed that path outright — the wording switch cannot bring it back.)
 */
export type MediaRefStyle = "path" | "at";
/**
 * Detect an image file's real format from its magic bytes. WeChat image
 * media is often PNG (or WebP/GIF) while the protocol gives no extension,
 * so a fixed `.jpg` name would leave the agent with a mislabeled file.
 * Returns the extension WITHOUT the leading dot; falls back to "jpg".
 */
export declare function detectImageExtension(buffer: Buffer): string;
/**
 * Extract text body from a WeChat message's item_list.
 */
export declare function extractText(itemList?: MessageItem[]): string;
/**
 * Find the first media item in a message.
 */
export declare function findMediaItem(itemList?: MessageItem[]): MessageItem | undefined;
/**
 * Whether a media item may be HELD so it can share a turn with the sentence
 * the user types next (图片/文件合并).
 *
 * Deliberately narrower than {@link findMediaItem}:
 *
 *   - an IMAGE / FILE / VIDEO (the three the feature is about);
 *   - a VOICE item with an untouched transcript is EXCLUDED — it carries no
 *     usable payload here (`convertMediaItem` only ever answers "无转写"), so
 *     holding it would delay a turn to merge in a placeholder;
 *   - an item with no downloadable media reference is excluded, because the
 *     only thing holding it could produce is a "下载失败" line.
 */
export declare function isHoldableMediaItem(item: MessageItem | undefined): item is MessageItem;
/**
 * Convert a WeChat message to prompt content blocks for a DSH session.
 *
 * The WeChat surface context is NOT injected here — it lives in a
 * global runtime context (index.ts `dsh-wechat-surface`) so
 * user-message content stays clean: the session-title generator reads the
 * user message verbatim, and a hint block would pollute session titles.
 *
 * A saved media file is handed over as a pointer and nothing else — see
 * {@link mediaPointer} and {@link MediaRefStyle}. `opts.refStyle` picks the
 * SPELLING only; no mode inlines the file's content.
 */
export declare function weixinMessageToPrompt(msg: WeixinMessage, cdnBaseUrl: string, log: (msg: string) => void, tempDir: string, opts?: {
    refStyle?: MediaRefStyle;
}): Promise<PromptBlock[]>;
//# sourceMappingURL=inbound.d.ts.map