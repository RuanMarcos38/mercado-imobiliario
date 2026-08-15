import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

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
    plugins: [mcpPlugin()],
  },
});
