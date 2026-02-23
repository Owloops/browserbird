declare module '@novnc/novnc' {
  interface NoVncCredentials {
    username: string;
    password: string;
    target: string;
  }

  interface NoVncOptions {
    shared?: boolean;
    credentials?: NoVncCredentials;
    repeaterID?: string;
    wsProtocols?: string[];
  }

  interface NoVncEvents {
    connect: CustomEvent<Record<string, never>>;
    disconnect: CustomEvent<{ clean: boolean }>;
    credentialsrequired: CustomEvent<{ types: Array<keyof NoVncCredentials> }>;
    securityfailure: CustomEvent<{ status: number; reason?: string }>;
    clipboard: CustomEvent<{ text: string }>;
    bell: CustomEvent<Record<string, never>>;
    desktopname: CustomEvent<{ name: string }>;
    capabilities: CustomEvent<{ capabilities: RFB['capabilities'] }>;
    clippingviewport: CustomEvent<RFB['clippingViewport']>;
  }

  type NoVncEventType = keyof NoVncEvents;

  export default class RFB extends EventTarget {
    constructor(target: Element, url: string | WebSocket | RTCDataChannel, options?: NoVncOptions);

    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    readonly capabilities: { power: boolean };
    readonly clippingViewport: boolean;

    addEventListener<T extends NoVncEventType>(
      type: T,
      listener: (event: NoVncEvents[T]) => void,
    ): void;
    addEventListener(type: string, listener: (event: CustomEvent) => void): void;
    removeEventListener<T extends NoVncEventType>(
      type: T,
      listener: (event: NoVncEvents[T]) => void,
    ): void;
    removeEventListener(type: string, listener: (event: CustomEvent) => void): void;

    disconnect(): void;
    sendCredentials(credentials: NoVncCredentials): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    sendCtrlAltDel(): void;
    focus(options?: FocusOptions): void;
    blur(): void;
    machineShutdown(): void;
    machineReboot(): void;
    machineReset(): void;
    clipboardPasteFrom(text: string): void;
    toDataURL(type?: string, encoderOptions?: number): string;
    toBlob(callback: (blob: Blob) => void, type?: string, quality?: number): void;
  }
}
