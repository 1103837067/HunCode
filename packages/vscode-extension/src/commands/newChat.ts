import type { RpcClient } from "../backend/RpcClient.js";

export function newChat(rpcClient: RpcClient): void {
	rpcClient.sendCommand({ type: "new_session" });
}
