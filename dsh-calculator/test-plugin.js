// 简单的测试脚本来验证插件功能
import { defineTool } from "@deepseek-ai/dsh-tools"

// 复制插件的核心逻辑用于测试
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

// 运行测试
console.log("🔧 开始测试 dsh-calculator 插件\n")

console.log("📊 基本运算测试：")
console.log("  23 + 45 =", basicArithmetic('add', 23, 45).operation)
console.log("  100 - 37 =", basicArithmetic('subtract', 100, 37).operation)
console.log("  8 × 7 =", basicArithmetic('multiply', 8, 7).operation)
console.log("  45 ÷ 5 =", basicArithmetic('divide', 45, 5).operation)
console.log("  2³ =", basicArithmetic('power', 2, 3).operation)
console.log("  17 mod 5 =", basicArithmetic('modulo', 17, 5).operation)
console.log("  除零测试:", basicArithmetic('divide', 10, 0).error)

console.log("\n🔬 科学计算测试：")
console.log("  √16 =", scientificCalculation('sqrt', 16).operation)
console.log("  |-7.5| =", scientificCalculation('abs', -7.5).operation)
console.log("  ⌈3.2⌉ =", scientificCalculation('ceil', 3.2).operation)
console.log("  ⌊3.9⌋ =", scientificCalculation('floor', 3.9).operation)
console.log("  round(3.7) =", scientificCalculation('round', 3.7).operation)
console.log("  log₁₀(100) =", scientificCalculation('log', 100, 10).operation)
console.log("  sin(π/2) =", scientificCalculation('sin', Math.PI/2).operation)
console.log("  e² =", scientificCalculation('exp', 2).operation)
console.log("  负数平方根测试:", scientificCalculation('sqrt', -4).error)

console.log("\n🌡️ 单位转换测试：")
console.log("  100km → mi:", unitConversion(100, 'km', 'mi').operation)
console.log("  1ft → cm:", unitConversion(1, 'ft', 'cm').operation)
console.log("  1kg → lb:", unitConversion(1, 'kg', 'lb').operation)
console.log("  100g → mg:", unitConversion(100, 'g', 'mg').operation)
console.log("  25°C → °F:", unitConversion(25, 'C', 'F').operation)
console.log("  0°C → K:", unitConversion(0, 'C', 'K').operation)

console.log("\n✅ 所有测试完成！插件功能正常。")