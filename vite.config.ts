import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react";
          }

          if (
            id.includes("node_modules/antd") ||
            id.includes("node_modules/@ant-design") ||
            id.includes("node_modules/rc-")
          ) {
            return "antd";
          }

          if (id.includes("node_modules/echarts") || id.includes("node_modules/zrender")) {
            return "charts";
          }

          if (id.includes("node_modules/@xyflow")) {
            return "flow";
          }
        },
      },
    },
  },
});
