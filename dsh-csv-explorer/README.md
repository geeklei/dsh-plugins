# dsh-csv-explorer

CSV 数据探查插件（v0.1.0）：分隔符感知的预览与数值列统计。轻量设计，不解析 Excel 二进制格式。

## 安装

```bash
npm install dsh-csv-explorer
```

## 工具

### `csv_preview`

| 参数 | 类型 | 说明 |
|------|------|------|
| `text` / `file` | string | 源内容二选一（file 须在工作目录内） |
| `rows` | number | 预览行数（默认 5，上限 50） |
| `delimiter` | string | 可选，显式分隔符；缺省自动嗅探（`,` `;` `\t` `\|` 取前 10 行众数） |

输出：分隔符、总行数、列数 + Markdown 表格预览。自动处理 BOM 与 CRLF；引号内分隔符正确切分（csv-parse）；短行补齐、长行截断到表头宽度；空表头自动命名 `列N`。

### `csv_stats`

| 参数 | 类型 | 说明 |
|------|------|------|
| `columns` | array | 可选，列名或 0 基下标；缺省统计全部数值列 |
| `text` / `file` | string | 源内容二选一 |
| `delimiter` | string | 可选，显式分隔符 |

**数值识别**：支持千分位（`1,200.50`）、百分号（`85%`）、货币符号前后缀（`¥99`、`$1,000`）、科学计数法。

**每列输出**：`count`（数值单元格数）、非数值个数、`min` / `max` / `mean` / `median`（偶数行取均值）/ `std`（总体标准差）/ `sum`。非数值列标注跳过。

## 使用步骤

### 1. 准备数据

CSV 文件放在**工作目录内**（如 `./data/sales.csv`），或直接把 CSV 内容作为 `text` 传入。注意：本插件不解析 Excel（.xlsx）二进制，Excel 数据请先另存为 CSV。

### 2. 先预览再统计

推荐先 `csv_preview` 确认结构（分隔符、表头、行数），再 `csv_stats` 统计：

```
csv_preview({ file: "data/sales.csv", rows: 5 })
csv_stats({ file: "data/sales.csv" })
```

### 3. 只统计关心的列

`columns` 支持列名或 0 基下标（混用）：

```
csv_stats({ file: "data/sales.csv", columns: ["amount", "3"] })
```

列名不确定时先用不带 `columns` 的 `csv_stats`，输出会标注每列下标与是否为数值列。

### 4. 解读输出

- 预览开头会标注 `分隔符`（自动嗅探或显式指定）与 `总行数`，出现“数据行超过 50000”提示说明统计只覆盖前 5 万行
- 统计里 `非数值 N 个` 表示该列有 N 个单元格无法识别为数字（含空单元格）
- `median` 在偶数个数值时取中间两数均值；`std` 为总体标准差
- 出现 `[输出已截断]` 标记说明内容不完整，缩小 `rows` 或 `columns` 后重试

### 5. 非逗号分隔的文件

自动嗅探覆盖 `,` `;` Tab `|` 四种；嗅探错了（如单列文件里恰好含逗号）用 `delimiter` 显式指定：

```
csv_preview({ file: "data.tsv", delimiter: "\t" })
```

## 限制

- 输入上限 2MB / 5 万行（超出部分不计入统计并明确提示）
- 文件路径必须在工作目录内
- 不解析 Excel（.xlsx）二进制；需要时先转 CSV
- 唯一依赖 `csv-parse`（健壮的 RFC4180 解析）

## 测试

```bash
npm test
```

覆盖 4 种分隔符嗅探、引号切分、BOM/CRLF、短长行对齐、9 例数值识别、列名/下标选列、统计口径（中位数/标准差）、路径越界拒绝等 45 项断言。

## Roadmap（v0.2 候选）

- 按列值过滤行（`filter` 工具）
- 分类列的频次统计（top N）
- 大文件流式统计（当前全量载入内存）
