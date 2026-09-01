# dsh-plugin-calculator

一个面向 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的数学计算工具插件。

为模型提供三个数学工具：
- `basic_arithmetic`：基本数学运算（加减乘除、幂运算、取模）
- `scientific_calculation`：科学数学计算（三角函数、对数、指数等）
- `unit_conversion`：单位转换（长度、重量、温度）

## 功能特性

### 1. 基本数学运算 (`basic_arithmetic`)
支持六种基本运算：
- `add`：加法
- `subtract`：减法
- `multiply`：乘法
- `divide`：除法
- `power`：幂运算
- `modulo`：取模运算

### 2. 科学数学计算 (`scientific_calculation`)
支持多种科学计算：
- `sqrt`：平方根
- `abs`：绝对值
- `ceil`：向上取整
- `floor`：向下取整
- `round`：四舍五入
- `log`：对数（可选底数，默认自然对数）
- `sin`：正弦函数
- `cos`：余弦函数
- `tan`：正切函数
- `exp`：指数函数（e^x）

### 3. 单位转换 (`unit_conversion`)
支持多种单位转换：

**长度单位：**
- `m`：米
- `km`：千米
- `cm`：厘米
- `mm`：毫米
- `in`：英寸
- `ft`：英尺
- `mi`：英里

**重量单位：**
- `kg`：千克
- `g`：克
- `mg`：毫克
- `lb`：磅
- `oz`：盎司

**温度单位：**
- `C`：摄氏度
- `F`：华氏度
- `K`：开尔文

## 本地开发

```bash
# 安装依赖
pnpm install

# 用绝对路径临时调试（name 指向本插件的入口文件）
cat > debug.patch.yml <<"EOF"
- insert:
    - id: calculator
      name: "E:/dsh-plugins/dsh-plugin-calculator/index.js"
EOF

# 启动 dsh Web 并加载插件，打开 http://127.0.0.1:3080
pnpm dsh web --patch ./debug.patch.yml
```

## 安装到 profile

先构建 tarball：

```bash
pnpm pack
```

然后把它安装到目标机器上的 dsh：

```bash
dsh plugin --profile web add ./dsh-plugin-calculator-0.1.0.tgz
```

验证配置是否生效：

```bash
dsh plugin --profile web --dump-config
```

卸载：

```bash
dsh plugin --profile web remove dsh-plugin-calculator
```

## 发布到 npm

```bash
# 确认已登录（首次先执行 npm login）
npm whoami

# 发布
npm publish
```

发布后，任何用户都可以通过 `dsh plugin --profile web add dsh-plugin-calculator` 安装。

## 插件结构说明

- `index.js`：插件入口，导出 `name` / `inject` / `apply(ctx)`，通过 `ctx.tools.register(defineTool(...))` 注册工具。
- `cordis.patch.yml`：Bundle 的 patch 声明，把插件 `insert` 到运行时的 profile 中。
- `package.json` 中的 `dsh.bundle.patch` 字段：告诉 dsh 该包使用哪个 patch 文件。

## 使用示例

安装插件后，AI 模型可以调用以下工具：

### 基本运算
```
用户: 计算 23 加 45
AI: 调用 basic_arithmetic 工具，operation="add", a=23, b=45
结果: 23 + 45 = 68
```

### 科学计算
```
用户: 计算 16 的平方根
AI: 调用 scientific_calculation 工具，operation="sqrt", value=16
结果: √16 = 4
```

### 单位转换
```
用户: 把 100 公里转换成英里
AI: 调用 unit_conversion 工具，value=100, fromUnit="km", toUnit="mi"
结果: 100km = 62.13711922373339mi
```

## 常见坑

- 插件名 `name` 必须全局唯一，安装后会被记录在 profile 配置里。
- `inject` 声明依赖的服务（这里是 `tools`），不声明会拿不到 `ctx.tools`。
- dsh 仍处于开发者预览阶段，API 可能随版本变化，注意锁定 `@deepseek-ai/dsh-tools` 的版本。
- 数学运算中的除法需要注意除数为零的情况。
- 科学计算中的三角函数使用弧度制。

## 技术细节

### 参数验证
- 所有数字参数都会进行类型转换和验证
- 提供详细的错误信息帮助调试

### 输出格式
- 工具返回格式化的字符串，包含计算过程和结果
- 支持中文显示，提升用户体验

### 安全性
- 所有计算都在本地执行，不涉及外部 API 调用
- 输入验证防止常见的数学错误（如除零、负数平方根等）

## License

MIT