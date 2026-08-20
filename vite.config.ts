import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// @lovable.dev/mcp-js 0.26.2 compares mixed Windows path separators during Vite startup.
// The generated MCP routes are committed; EasyPanel/Linux still regenerates them at build time.
const mcpPlugins = process.platform === "win32" ? [] : [mcpPlugin()];

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Self-hosting / EasyPanel: Nitro emits .output/server/index.mjs.
  // Lovable's build pipeline may override the runtime target for its own hosting.
  nitro: {
    preset: "node-server",
  },
  vite: {
    plugins: mcpPlugins,
  },
});
