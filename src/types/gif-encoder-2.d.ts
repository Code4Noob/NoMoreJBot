// gif-encoder-2 冇自帶 TypeScript types，自己聲明用得到嘅 API
declare module "gif-encoder-2" {
    class GIFEncoder {
        constructor(
            width?: number,
            height?: number,
            mode?: "rgb" | "rgba",
            useLZW?: boolean,
            chunkSize?: number
        );
        start(): void;
        finish(): void;
        addFrame(data: Uint8Array | Uint8ClampedArray | Buffer): void;
        setDelay(millisec: number): void;
        setRepeat(repeat: number): void;
        setQuality(quality: number): void;
        out: { getData(): Buffer };
    }
    export = GIFEncoder;
}
