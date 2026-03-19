import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ts-sdk-error-page/",
  plugins: [react()],
});
