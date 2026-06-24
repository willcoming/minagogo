import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const githubPagesBase = process.env.GITHUB_PAGES_BASE?.replace(/^\/+|\/+$/g, "");

export default defineConfig({
  base: githubPagesBase ? `/${githubPagesBase}/` : "/",
  plugins: [react()],
});
