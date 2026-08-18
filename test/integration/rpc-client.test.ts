import path from "node:path";
import { describe, expect, it } from "vitest";
import { RpcClient } from "../../src/rpc/rpc-client.js";

const fixture = path.resolve("test/fixtures/fake-rpc.mjs");

describe("RpcClient integration", () => {
  it("correlates responses across chunk boundaries and disposes the child", async () => {
    const client = RpcClient.launch(process.execPath, [fixture], {
      requestTimeoutMs: 1_000,
      killTimeoutMs: 250,
    });
    const pid = client.pid;

    await expect(client.request("get_state")).resolves.toMatchObject({ sessionId: "fixture" });
    await client.dispose();

    expect(client.process.exitCode).toBe(0);
    expect(pid).toBeTypeOf("number");
  });

  it("rejects requests after disposal", async () => {
    const client = RpcClient.launch(process.execPath, [fixture]);
    await client.dispose();
    await expect(client.request("get_state")).rejects.toThrow("disposed");
  });
});
