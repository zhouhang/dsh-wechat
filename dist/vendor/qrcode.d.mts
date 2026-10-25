export function qrcode(typeNumber: any, errorCorrectionLevel: any): {
    addData(data: any, mode: any): void;
    isDark(row: any, col: any): any;
    getModuleCount(): number;
    make(): void;
    createTableTag(cellSize: any, margin: any): string;
    createSvgTag(cellSize: any, margin: any, alt: any, title: any, ...args: any[]): string;
    createDataURL(cellSize: any, margin: any): string;
    createImgTag(cellSize: any, margin: any, alt: any): string;
    createASCII(cellSize: any, margin: any): string;
    renderTo2dContext(context: any, cellSize: any): void;
};
export namespace qrcode {
    function stringToBytes(s: any): number[];
    /**
     * @param unicodeData base64 string of byte array.
     * [16bit Unicode],[16bit Bytes], ...
     * @param numChars
     */
    function createStringToBytes(unicodeData: any, numChars: any): (s: any) => any[];
}
export default qrcode;
export function stringToBytes(s: any): number[];
//# sourceMappingURL=qrcode.d.mts.map