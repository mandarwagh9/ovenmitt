import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({ command: process.execPath, args: ["mcp/server.mjs"] });
const c = new Client({ name: "smoke", version: "0" });
await c.connect(t);

const tools = await c.listTools();
console.log("tools:", tools.tools.map((x) => x.name).join(", "));

for (const call of [
  { name: "mitt_chain_info", arguments: {} },
  { name: "mitt_status", arguments: { agent: "6pN65FYnzkvfURxFWFJzuerqhT7CWo5CSk7TL5rYESDD" } },
  { name: "mitt_spend", arguments: { to: "6pN65FYnzkvfURxFWFJzuerqhT7CWo5CSk7TL5rYESDD", amount: 0.01, reason: "should refuse, no key" } },
]) {
  const r = await c.callTool(call);
  console.log(`\n--- ${call.name} (isError=${!!r.isError}) ---`);
  console.log(r.content.map((x) => x.text).join("\n"));
}
await c.close();
