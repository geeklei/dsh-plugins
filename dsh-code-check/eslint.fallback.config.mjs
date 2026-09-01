// 兜底配置：当被审查的项目没有自己的 eslint.config.* 时使用。
// 同时支持 JavaScript 与 TypeScript（typescript-eslint 解析器）。保持规则集小而通用，避免对陌生项目产生大量误报。
import tseslint from "typescript-eslint"

const globals = {
  // Node 常用
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  fetch: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  // 浏览器常用
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  localStorage: "readonly",
}

const commonRules = {
  "no-var": "warn",
  "prefer-const": "warn",
  eqeqeq: "warn",
  curly: "warn",
  "no-debugger": "error",
  "no-unreachable": "error",
  "no-duplicate-imports": "warn",
}

export default [
  // JavaScript 文件
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals,
    },
    rules: {
      ...commonRules,
      "no-unused-vars": "warn",
      "no-undef": "warn",
    },
  },

  // TypeScript 文件（typescript-eslint 推荐规则 + 类型级检查）
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals,
    },
    rules: {
      ...commonRules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
]