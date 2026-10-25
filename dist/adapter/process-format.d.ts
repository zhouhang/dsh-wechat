import type { OutputContentBlock, ToolResultData } from "../dsh/types.js";
export declare function desktopToolSummary(name: string, raw: string, cwd?: string): string;
export declare function reasoningSummary(text: string): string;
/** The collapsed desktop row shows only the first error line; success output is hidden. */
export declare function toolResultSummary(data: ToolResultData): string;
/** One compact group between assistant prose, with desktop collapsed-row content. */
export declare class ExecutionProcess {
    private cwd?;
    private entries;
    private omitted;
    private calls;
    private previousTodos?;
    constructor(cwd?: string | undefined);
    private append;
    addReasoning(block: OutputContentBlock): void;
    private todoSummary;
    addCall(callId: string, name: string, args: string): void;
    addResult(data: ToolResultData): void;
    take(limit: number): string | undefined;
}
//# sourceMappingURL=process-format.d.ts.map