import { describe, expect, it } from "vitest";
import { messageSize, roleForPath } from "../src/relay";

describe("relay route helpers", () => {
  it("maps websocket paths to roles", () => {
    expect(roleForPath("/v1/gateway")).toBe("gateway");
    expect(roleForPath("/v1/device")).toBe("device");
    expect(roleForPath("/healthz")).toBeNull();
  });

  it("measures string and binary frame sizes", () => {
    expect(messageSize("abc")).toBe(3);
    expect(messageSize(new Uint8Array([1, 2, 3]).buffer)).toBe(3);
  });
});
