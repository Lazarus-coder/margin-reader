export interface ReaderNativeState {
  compact: boolean;
  alwaysOnTop: boolean;
  opacity: number;
  hideDock: boolean;
  hideShortcutAvailable: boolean;
}

export interface ReaderNativeAPI {
  readonly isNative: true;
  readonly platform: string;
  setCompact(compact: boolean): Promise<void>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  setOpacity(opacity: number): Promise<void>;
  setHideDock(hideDock: boolean): Promise<void>;
  hide(): Promise<void>;
  minimize(): Promise<void>;
  close(): Promise<void>;
  getState(): Promise<ReaderNativeState>;
  onState(callback: (state: ReaderNativeState) => void): () => void;
  onBeforeClose(callback: () => Promise<void>): () => void;
}

declare global {
  interface Window {
    readerNative?: ReaderNativeAPI;
  }
}
