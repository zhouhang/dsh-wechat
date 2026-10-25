/**
 * Vendored message construction helpers.
 *
 * These mirror `createUserMessage` from `@deepseek-ai/dsh-llm` (lib/types/
 * message.js): spread the input, mint a fresh `crypto.randomUUID()` id,
 * `structuredClone` the result, and deep-freeze the clone. Vendored so the
 * bridge has zero runtime dependency on `@deepseek-ai/*` packages (which
 * are not resolvable from a third-party plugin's location in the profile
 * node_modules).
 */
import type { ContentBlock, UserMessage, UserMessageSource } from "./types.js";
/** Create one identified user-role message and freeze it before publication. */
export declare function createUserMessage(input: {
    content: ContentBlock[];
    source: UserMessageSource;
}): UserMessage;
//# sourceMappingURL=messages.d.ts.map