# dsh-http-client

受控 HTTP 客户端插件（v0.1.0）：让模型能调外部 API，但只能在明确划定的安全边界内。

## 安装

```bash
npm install dsh-http-client
```

## 工具

### `http_get` / `http_post`

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | 必填，完整 http(s) URL |
| `body` | string | POST 必填，请求体字符串（JSON 配 `Content-Type: application/json`） |
| `headers` | object | 可选，请求头 |
| `timeout_ms` | number | 可选，默认 15000，上限 60000 |
| `allow_unlisted` | boolean | 可选，主机不在白名单时首次放行并写入白名单文件 |

## 安全边界（本插件的核心）

1. **域名白名单**：工作目录 `.http-allowlist.json`（`{"allow": ["api.example.com", "*.example.com"]}`）；白名单文件损坏时按空白名单处理（fail closed）
2. **首次放行机制**：不在白名单的主机默认拒绝；`allow_unlisted=true` 时追加到白名单文件，之后无需重复确认
3. **禁止 IP 直连**：白名单基于域名，`http://192.168.1.1` 直接拒绝
4. **禁止 userinfo**：`http://user:pass@host` 拒绝
5. **端口限制**：远程主机仅允许 80/443（localhost 例外，方便本地开发调试）
6. **超时**：默认 15s，上限 60s，超时中止
7. **响应体上限 1MB**：流式读取，超限立即中止并标注截断
8. **输出截断**：返回给模型的文本超 8000 字符再截断，两道截断标记都保留在末尾
9. **零依赖**：基于 Node 内置 `fetch`，无第三方 HTTP 库

## 测试

```bash
npm test
```

测试在本地临时 http 服务器上进行（`localhost` 任意端口的例外设计使然），覆盖白名单匹配/放行/持久化、5 类恶意 URL 拒绝、POST、超时、双重截断、重定向跟随，共 22 项断言。

## Roadmap（v0.2 候选）

- 每 hosts 限速（防止高频请求）
- 响应头白名单输出（默认只回 body，减少噪音）
- PUT/DELETE 方法支持
