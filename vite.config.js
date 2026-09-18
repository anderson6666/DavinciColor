import { defineConfig } from 'vite';
import { realpathSync } from 'node:fs';
import react from '@vitejs/plugin-react';

// 项目可能位于目录联接(Junction)下（C: 指向 D:），Node realpath 与 cwd 不一致会导致
// 构建时 index.html 被解析成绝对路径从而报错。统一用 realpath 作为 root。
const root = realpathSync(process.cwd());

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});