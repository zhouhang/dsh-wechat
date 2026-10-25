/**
 * Secret masking for text that leaves the trust boundary.
 *
 * Scope — this function is for ERROR text, excerpts and telemetry only.
 * It must NEVER be applied to an agent's normal reply body: the hex and
 * base64 rules below are deliberately greedy (`32+` hex, `40+` base64)
 * and would mangle every commit SHA, content hash, file digest, hex
 * payload and long identifier in a legitimate answer. An agent that
 * explains a git rebase would come back with `***` where the SHAs were.
 *
 * Everything here is a heuristic over shapes, not an entropy detector.
 * It is intentionally cheap, pure and synchronous: it runs on the error
 * path where an exception must not become a second failure.
 */
/**
 * Mask secret-shaped substrings in one text.
 *
 * Idempotent by construction: every replacement yields `***`, and no
 * rule can match a run of asterisks or start inside one, so a second
 * pass over already-masked text is a no-op. That matters because error
 * text is masked on the way into a notification and again when the
 * notification is flushed from a hold.
 *
 * @param text - text about to leave for WeChat (an error, an excerpt, a
 *   telemetry line) — never a normal agent reply.
 * @returns the same text with every detected secret replaced by `***`.
 */
export declare function maskSecrets(text: string): string;
/**
 * Mask a WeChat user id for a LOG LINE.
 *
 * Logs are the one artifact that routinely leaves the machine (bug reports,
 * CI transcripts, pasted terminal output), and a WeChat user id is a stable
 * handle on a real person. The short head/tail are kept so an operator can
 * still correlate two lines about the same sender, and a very short id is
 * masked whole (there is nothing to keep that would not identify it).
 *
 * NOT used for text sent back to WeChat: the bound peer sees their own id in
 * `/status` on purpose (S3 — the owner must never have to guess it), and an
 * id must not be masked inside a message the user is supposed to read.
 */
export declare function maskUserId(userId: string): string;
//# sourceMappingURL=redact.d.ts.map