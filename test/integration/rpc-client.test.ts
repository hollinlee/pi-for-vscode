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

  it("times out one request without breaking later correlation", async () => {
    const client = RpcClient.launch(process.execPath, [fixture], { requestTimeoutMs: 30 });
    await expect(client.request("never")).rejects.toThrow("timed out");
    await expect(client.request("get_state")).resolves.toMatchObject({ sessionId: "fixture" });
    await client.dispose();
  });

  it("emits protocol errors for invalid JSON", async () => {
    const client = RpcClient.launch(process.execPath, [fixture]);
    const protocolError = nextEvent(client, "protocolError");
    const pending = client.request("invalid").catch((error: unknown) => error);

    const error = await protocolError;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Invalid pi RPC JSON");

    await client.dispose();
    await expect(pending).resolves.toBeInstanceOf(Error);
  });

  it("rejects malformed response schemas as protocol errors", async () => {
    const client = RpcClient.launch(process.execPath, [fixture]);
    const protocolError = nextEvent(client, "protocolError");
    const pending = client.request("malformed_response").catch((error: unknown) => error);

    await expect(protocolError).resolves.toMatchObject({ message: "Invalid pi RPC response schema" });
    await client.dispose();
    await expect(pending).resolves.toBeInstanceOf(Error);
  });

  it("reports an incomplete final record when the child exits", async () => {
    const client = RpcClient.launch(process.execPath, [fixture]);
    const protocolError = nextEvent(client, "protocolError");
    const pending = client.request("incomplete_exit").catch((error: unknown) => error);

    await expect(protocolError).resolves.toMatchObject({ message: "RPC stream ended with an incomplete JSONL record" });
    await expect(pending).resolves.toBeInstanceOf(Error);
  });

  it("emits non-response records while resolving the request", async () => {
    const client = RpcClient.launch(process.execPath, [fixture]);
    const event = nextEvent(client, "event");

    await expect(client.request("emit_event")).resolves.toMatchObject({ sessionId: "fixture" });
    await expect(event).resolves.toEqual({ type: "fixture_event", value: 42 });
    await client.dispose();
  });
});

function nextEvent(client: RpcClient, event: string): Promise<unknown> {
  return new Promise((resolve) => client.once(event, (value: unknown) => resolve(value)));
}
