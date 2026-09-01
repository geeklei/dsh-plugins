// 兜底配置：当被审查的项目没有自己的 eslint.config.* 时使用。
// 保持规则集小而通用，避免对陌生项目产生大量误报。
export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
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
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-var": "warn",
      "prefer-const": "warn",
      eqeqeq: "warn",
      curly: "warn",
      "no-debugger": "error",
      "no-unreachable": "error",
      "no-duplicate-imports": "warn",
    },
  },
]
