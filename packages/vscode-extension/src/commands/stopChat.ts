import type { RpcClient } from "../backend/RpcClient.js";

export function stopChat(rpcClient: RpcClient): void {
	rpcClient.sendCommand({ type: "abort" });
}
