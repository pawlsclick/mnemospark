import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startProxyMock = vi.fn();
const resolveWalletMock = vi.fn();

vi.mock("./proxy.js", () => ({
  startProxy: (...args: unknown[]) => startProxyMock(...args),
}));

vi.mock("./auth.js", () => ({
  resolveOrGenerateWalletKey: () => resolveWalletMock(),
}));

vi.mock("./balance.js", () => ({
  BalanceMonitor: class {
    checkBalance() {
      return Promise.resolve({ isEmpty: false, isLow: false, balanceUSD: "$1.00" });
    }
  },
}));

vi.mock("./openclaw-renewal-runbook.js", () => ({
  ensureOpenClawRenewalPrerequisites: () => Promise.resolve(),
}));

vi.mock("./mnemospark-handler.js", () => ({
  runMnemosparkSlashHandler: vi.fn(),
}));

describe("mnemospark-proxy service lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    startProxyMock.mockReset();
    resolveWalletMock.mockReset();
    resolveWalletMock.mockResolvedValue({
      key: "0xkey",
      address: "0xabc",
      source: "saved",
    });
    startProxyMock.mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeApi() {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const services: Array<{
      id: string;
      start: () => void | Promise<void>;
      stop?: () => void | Promise<void>;
    }> = [];
    return {
      api: {
        id: "mnemospark",
        name: "mnemospark",
        version: "test",
        description: "test",
        source: "test",
        config: {},
        pluginConfig: {},
        logger,
        registerProvider: vi.fn(),
        registerTool: vi.fn(),
        registerHook: vi.fn(),
        registerHttpRoute: vi.fn(),
        registerService: (svc: (typeof services)[number]) => services.push(svc),
        registerCommand: vi.fn(),
        resolvePath: (p: string) => p,
        on: vi.fn(),
      },
      services,
      logger,
    };
  }

  it("does not start proxy during register(); starts when service.start() runs", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, services } = makeApi();

    plugin.register?.(api);
    expect(startProxyMock).not.toHaveBeenCalled();

    const proxyService = services.find((s) => s.id === "mnemospark-proxy");
    expect(proxyService).toBeDefined();
    expect(typeof proxyService?.start).toBe("function");

    await proxyService!.start!();
    expect(startProxyMock).toHaveBeenCalledTimes(1);
  });

  it("ensureProxyStarted is idempotent across concurrent start() calls", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, services } = makeApi();

    plugin.register?.(api);
    const proxyService = services.find((s) => s.id === "mnemospark-proxy");
    expect(proxyService).toBeDefined();

    let releaseStart!: (handle: { close: () => Promise<void> }) => void;
    const startGate = new Promise<{ close: () => Promise<void> }>((resolve) => {
      releaseStart = resolve;
    });
    startProxyMock.mockImplementation(() => startGate);

    const first = proxyService!.start!();
    const second = proxyService!.start!();
    releaseStart({ close: vi.fn().mockResolvedValue(undefined) });
    await Promise.all([first, second]);

    expect(startProxyMock).toHaveBeenCalledTimes(1);
  });

  it("stop() closes the active proxy handle", async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    startProxyMock.mockResolvedValue({ close: closeMock });

    const { default: plugin } = await import("./index.js");
    const { api, services } = makeApi();

    plugin.register?.(api);
    const proxyService = services.find((s) => s.id === "mnemospark-proxy");
    await proxyService!.start!();
    await proxyService!.stop!();

    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
