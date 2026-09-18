declare module "resumable-stream" {
  export function createResumableStreamContext(options: {
    waitUntil?: (promise: Promise<unknown>) => void;
    [key: string]: unknown;
  }): {
    resumableStream: (
      streamId: string,
      makeStream: () => ReadableStream,
      skipCharacters?: number
    ) => Promise<ReadableStream | undefined>;
    createNewResumableStream: (
      streamId: string,
      makeStream: () => ReadableStream
    ) => Promise<ReadableStream | undefined>;
    hasExistingStream: (streamId: string) => Promise<boolean | null>;
  };
  export function resumeStream(...args: unknown[]): unknown;
}
