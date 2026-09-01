import { defineTool } from "@deepseek-ai/dsh-tools"

export const name = "calculator"
export const inject = ["tools"]

// 基本数学运算
function basicArithmetic(operation, a, b) {
  const numA = Number(a)
  const numB = Number(b)

  if (isNaN(numA) || isNaN(numB)) {
    return { error: "参数必须是有效的数字" }
  }

  switch (operation) {
    case 'add':
      return { result: numA + numB, operation: `${numA} + ${numB} = ${numA + numB}` }
    case 'subtract':
      return { result: numA - numB, operation: `${numA} - ${numB} = ${numA - numB}` }
    case 'multiply':
      return { result: numA * numB, operation: `${numA} × ${numB} = ${numA * numB}` }
    case 'divide':
      if (numB === 0) {
        return { error: "除数不能为零" }
      }
      return { result: numA / numB, operation: `${numA} ÷ ${numB} = ${numA / numB}` }
    case 'power':
      return { result: Math.pow(numA, numB), operation: `${numA}^${numB} = ${Math.pow(numA, numB)}` }
    case 'modulo':
      return { result: numA % numB, operation: `${numA} mod ${numB} = ${numA % numB}` }
    default:
      return { error: "不支持的运算" }
  }
}

// 科学计算
function scientificCalculation(operation, value, param2) {
  const num = Number(value)
  const param = param2 !== undefined ? Number(param2) : undefined

  if (isNaN(num)) {
    return { error: "参数必须是有效的数字" }
  }

  switch (operation) {
    case 'sqrt':
      if (num < 0) {
        return { error: "不能计算负数的平方根" }
      }
      return { result: Math.sqrt(num), operation: `√${num} = ${Math.sqrt(num)}` }
    case 'abs':
      return { result: Math.abs(num), operation: `|${num}| = ${Math.abs(num)}` }
    case 'ceil':
      return { result: Math.ceil(num), operation: `⌈${num}⌉ = ${Math.ceil(num)}` }
    case 'floor':
      return { result: Math.floor(num), operation: `⌊${num}⌋ = ${Math.floor(num)}` }
    case 'round':
      return { result: Math.round(num), operation: `round(${num}) = ${Math.round(num)}` }
    case 'log':
      if (num <= 0) {
        return { error: "对数函数的参数必须大于零" }
      }
      const base = param !== undefined && !isNaN(param) ? param : Math.E
      return { result: Math.log(num) / Math.log(base), operation: `log_${base}(${num}) = ${Math.log(num) / Math.log(base)}` }
    case 'sin':
      return { result: Math.sin(num), operation: `sin(${num}) = ${Math.sin(num)}` }
    case 'cos':
      return { result: Math.cos(num), operation: `cos(${num}) = ${Math.cos(num)}` }
    case 'tan':
      return { result: Math.tan(num), operation: `tan(${num}) = ${Math.tan(num)}` }
    case 'exp':
      return { result: Math.exp(num), operation: `e^${num} = ${Math.exp(num)}` }
    default:
      return { error: "不支持的科学计算" }
  }
}

// 单位转换
function unitConversion(value, fromUnit, toUnit) {
  const num = Number(value)
  if (isNaN(num)) {
    return { error: "数值必须是有效的数字" }
  }

  // 长度单位转换（以米为基准）
  const lengthUnits = {
    'm': 1,           // 米
    'km': 1000,       // 千米
    'cm': 0.01,       // 厘米
    'mm': 0.001,      // 毫米
    'in': 0.0254,     // 英寸
    'ft': 0.3048,     // 英尺
    'mi': 1609.344,   // 英里
  }

  // 重量单位转换（以千克为基准）
  const weightUnits = {
    'kg': 1,          // 千克
    'g': 0.001,       // 克
    'mg': 0.000001,   // 毫克
    'lb': 0.453592,   // 磅
    'oz': 0.0283495,  // 盎司
  }

  // 温度单位转换
  const convertTemperature = (value, from, to) => {
    let celsius
    // 先转换为摄氏度
    switch (from.toLowerCase()) {
      case 'c': celsius = value; break
      case 'f': celsius = (value - 32) * 5/9; break
      case 'k': celsius = value - 273.15; break
      default: return { error: "不支持的温度单位" }
    }

    // 从摄氏度转换到目标单位
    switch (to.toLowerCase()) {
      case 'c': return celsius
      case 'f': return celsius * 9/5 + 32
      case 'k': return celsius + 273.15
      default: return { error: "不支持的温度单位" }
    }
  }

  // 检查温度转换
  const tempUnits = ['c', 'f', 'k']
  if (tempUnits.includes(fromUnit.toLowerCase()) && tempUnits.includes(toUnit.toLowerCase())) {
    const result = convertTemperature(num, fromUnit, toUnit)
    if (result.error) return result
    return {
      result,
      operation: `${num}${fromUnit.toUpperCase()} = ${result}${toUnit.toUpperCase()}`
    }
  }

  // 长度转换
  if (lengthUnits[fromUnit] && lengthUnits[toUnit]) {
    const meters = num * lengthUnits[fromUnit]
    const result = meters / lengthUnits[toUnit]
    return {
      result,
      operation: `${num}${fromUnit} = ${result}${toUnit}`
    }
  }

  // 重量转换
  if (weightUnits[fromUnit] && weightUnits[toUnit]) {
    const kg = num * weightUnits[fromUnit]
    const result = kg / weightUnits[toUnit]
    return {
      result,
      operation: `${num}${fromUnit} = ${result}${toUnit}`
    }
  }

  return { error: "不支持的单位转换" }
}

export function apply(ctx) {
  // 注册基本数学运算工具
  ctx.tools.register(defineTool({
    name: "basic_arithmetic",
    description: "执行基本数学运算：加、减、乘、除、幂运算、取模",
    parameters: {
      operation: {
        type: "string",
        required: true,
        description: "运算类型：add(加), subtract(减), multiply(乘), divide(除), power(幂), modulo(取模)",
        enum: ["add", "subtract", "multiply", "divide", "power", "modulo"]
      },
      a: {
        type: "number",
        required: true,
        description: "第一个数字"
      },
      b: {
        type: "number",
        required: true,
        description: "第二个数字"
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      const result = basicArithmetic(args.operation, args.a, args.b)
      if (result.error) {
        return `错误: ${result.error}`
      }
      return result.operation
    },
  }))

  // 注册科学计算工具
  ctx.tools.register(defineTool({
    name: "scientific_calculation",
    description: "执行科学数学计算：平方根、绝对值、三角函数、对数等",
    parameters: {
      operation: {
        type: "string",
        required: true,
        description: "计算类型：sqrt(平方根), abs(绝对值), ceil(向上取整), floor(向下取整), round(四舍五入), log(对数), sin(正弦), cos(余弦), tan(正切), exp(指数)",
        enum: ["sqrt", "abs", "ceil", "floor", "round", "log", "sin", "cos", "tan", "exp"]
      },
      value: {
        type: "number",
        required: true,
        description: "要计算的数值"
      },
      param2: {
        type: "number",
        required: false,
        description: "可选参数，用于对数运算的底数"
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      const result = scientificCalculation(args.operation, args.value, args.param2)
      if (result.error) {
        return `错误: ${result.error}`
      }
      return result.operation
    },
  }))

  // 注册单位转换工具
  ctx.tools.register(defineTool({
    name: "unit_conversion",
    description: "执行单位转换：长度、重量、温度等单位之间的转换",
    parameters: {
      value: {
        type: "number",
        required: true,
        description: "要转换的数值"
      },
      fromUnit: {
        type: "string",
        required: true,
        description: "源单位"
      },
      toUnit: {
        type: "string",
        required: true,
        description: "目标单位"
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      const result = unitConversion(args.value, args.fromUnit, args.toUnit)
      if (result.error) {
        return `错误: ${result.error}`
      }
      return result.operation
    },
  }))
}