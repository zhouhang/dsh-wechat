/**
 * Approval card formatting and reply parsing for the WeChat mirror card.
 *
 * The card mirrors the DSH GUI approval card exactly (tool name, reason,
 * allow-once / reject) because it answers the same Host `approval/request`
 * waterfall; WeChat and GUI race, whoever answers first wins. Reply grammar:
 *   `1` / `2`          → positional (once / reject) for a single card
 *   `once` / `reject`  → keyword forms (case-insensitive)
 *   `P1=1 P2=2`        → per-card decisions when several are pending
 *   `P2-reject`        → dash forces reject for that card
 */
export type ApprovalReplyValue = "once" | "reject";
export interface ApprovalDecision {
    /** The card's rpcId (respond echo). */
    rpcId: string;
    reply: ApprovalReplyValue;
}
export interface PendingApprovalCard {
    rpcId: string;
    sessionId: string;
    approvalId: string;
    toolName: string;
    reason?: string;
    askedAt: number;
}
/** Max length of a freeform rejection message. */
declare const MAX_MESSAGE_LEN = 500;
/** Render one approval frame as a WeChat-friendly card (GUI-equivalent info). */
export declare function formatApprovalCard(entry: PendingApprovalCard, index?: number, total?: number): string;
/**
 * Parse the user's reply into per-card decisions.
 */
export declare function parseApprovalReply(input: string, pending: ReadonlyArray<PendingApprovalCard>): {
    decisions: ApprovalDecision[];
    warnings: string[];
};
/** Keep MAX_MESSAGE_LEN exported for parity with the reference grammar. */
export { MAX_MESSAGE_LEN };
//# sourceMappingURL=approval-format.d.ts.map