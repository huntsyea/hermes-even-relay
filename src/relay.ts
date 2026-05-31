export type SocketRole = "gateway" | "device";

export const MAX_FRAME_BYTES = 256 * 1024;

export function roleForPath(pathname: string): SocketRole | null {
  if (pathname === "/v1/gateway") {
    return "gateway";
  }
  if (pathname === "/v1/device") {
    return "device";
  }
  return null;
}

export function messageSize(message: string | ArrayBuffer): number {
  if (typeof message === "string") {
    return new TextEncoder().encode(message).byteLength;
  }
  return message.byteLength;
}
