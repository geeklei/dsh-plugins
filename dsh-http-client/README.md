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

## 使用步骤

### 1. 配置域名白名单

插件读取**工作目录**下的 `.http-allowlist.json`，两种初始化方式：

**方式 A：手动预配置**（推荐，先划好边界）

```json
{
  "allow": [
    "api.github.com",
    "open.bigmodel.cn",
    "*.deepseek.com"
  ]
}
```

- 精确匹配：`api.github.com` 只放行这个子域
- 通配匹配：`*.deepseek.com` 放行所有子域（不含裸域 `deepseek.com`，需要就两条都写）

**方式 B：首次放行逐步累积**——不预配置，调用时传 `allow_unlisted: true`，确认后自动把域名写进白名单文件，之后免确认。

### 2. 调用示例

GET 拉取数据：

```
http_get({ url: "https://api.github.com/zen" })
```

POST 提交 JSON：

```
http_post({
  url: "https://api.example.com/v1/notify",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer <token>" },
  body: "{\"title\": \"构建完成\"}"
})
```

### 3. 解读返回结果

每次调用返回固定结构：

```
URL: https://api.github.com/zen
状态: 200 OK
响应大小: 87 字节
白名单: api.github.com 在白名单内（共 3 条）

<body 内容>
```

注意两个截断标记：`[响应体超过 1024KB 上限，已截断]`（body 本身被砍）和 `[输出已截断，完整长度 N 字符]`（返回给模型的文本被砍）。出现任一说明数据不完整，应缩小请求范围。

### 4. 日常维护

- **加域名**：直接编辑 `.http-allowlist.json`，或让模型 `allow_unlisted` 放行
- **临时收回**：从白名单删掉条目即可，立即生效（每次调用都重新读文件）
- **审计**：白名单文件就是完整的信任域清单，定期过一遍即可

推荐工作流：项目里放一份只含必要 API 域名的白名单提交进 git，团队共享同一套边界；新需求碰到未覆盖域名时由使用者显式确认放行。

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
