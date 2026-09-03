/**
 * dsh 会话内容导出插件
 *
 * 该插件提供导出 dsh 会话内容的功能，支持多种格式和导出方式
 */

import { readFileSync } from 'node:fs';

export const name = 'dsh-session-exporter';

// 插件版本号：以 package.json 为唯一来源，避免元数据中的版本过期
const PLUGIN_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
).version;

/**
 * 用户输入校验类错误：消息可安全回显，不包含文件系统内部信息。
 * 其他内部错误（如 ENOENT/EACCES）一律对外隐藏详情，只写日志。
 */
class SafeError extends Error {}

/**
 * 将输出路径安全地限制在当前工作目录内。
 * - 拒绝 .. 路径穿越和绝对路径逃逸
 * - 沿目录链向上找到最深已存在祖先，校验其 realpath 未通过符号链接离开根目录
 */
async function resolveSafeOutputPath(outputPath) {
  const path = await import('node:path');
  const fs = await import('node:fs/promises');

  if (typeof outputPath !== 'string' || !outputPath.trim()) {
    throw new SafeError('输出路径无效');
  }

  const root = path.resolve(process.cwd());
  const target = path.resolve(root, outputPath);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new SafeError('输出路径必须位于当前工作目录内');
  }

  // 校验已存在的祖先目录未通过符号链接逃逸（目标可能尚不存在）
  let ancestor = path.dirname(target);
  while (true) {
    let actual;
    try {
      actual = await fs.realpath(ancestor);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw err;
        ancestor = parent;
        continue;
      }
      throw err;
    }
    const ancestorRel = path.relative(root, actual);
    if (ancestorRel === '..' || ancestorRel.startsWith(`..${path.sep}`) || path.isAbsolute(ancestorRel)) {
      throw new SafeError('输出路径不能通过符号链接离开当前工作目录');
    }
    break;
  }

  return target;
}

/**
 * 在安全位置写入导出内容
 */
async function writeOutputFile(outputPath, content) {
  const path = await import('node:path');
  const fs = await import('node:fs/promises');

  const target = await resolveSafeOutputPath(outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf-8');
  return target;
}

/** HTML 转义，防止导出内容注入脚本 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

/**
 * 导出会话内容的主函数
 * @param {Object} options - 导出选项
 * @param {Object} options.ctx - dsh 上下文对象
 * @param {string} options.format - 导出格式（json|markdown|txt|html）
 * @param {string} [options.outputPath] - 输出文件路径（可选）
 * @param {boolean} [options.includeMetadata=true] - 是否包含元数据
 * @param {boolean} [options.includeTimestamps=true] - 是否包含时间戳
 * @param {boolean} [options.sanitize=true] - 是否清理敏感信息
 * @returns {Promise<string>} 导出的内容
 */
export async function exportSession(options) {
  const {
    ctx,
    format = 'markdown',
    outputPath,
    includeMetadata = true,
    includeTimestamps = true,
    sanitize = true
  } = options;

  try {
    // 收集会话数据
    const data = await collectSessionData(ctx, includeMetadata, includeTimestamps, sanitize);

    // 关闭脱敏时在返回值中显式告警，确保工具调用入口也能感知风险
    const warning = sanitize ? '' : '[警告] 已关闭敏感信息清理，导出内容可能包含密钥等机密信息，请妥善保管。\n\n';
    // 格式化内容
    const content = formatSessionData(data, format, includeMetadata, includeTimestamps);

    // 如果指定了输出路径，写入文件（路径被限制在当前工作目录内）
    if (outputPath) {
      const target = await writeOutputFile(outputPath, content);
      return warning + `会话内容已导出到: ${target}`;
    }

    return warning + content;
  } catch (error) {
    console.error('导出会话失败:', error);
    if (error instanceof SafeError) throw error;
    throw new Error('导出会话失败，详细原因请查看日志');
  }
}

export const inject = ['tools', 'commands'];

export function apply(ctx) {
  // 工具注册
  ctx.tools.register({
    id: 'export-session',
    name: '导出会话',
    description: '导出当前会话的内容到指定格式',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['json', 'markdown', 'txt', 'html'],
          description: '导出格式',
          default: 'markdown'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径（可选）'
        },
        includeMetadata: {
          type: 'boolean',
          description: '是否包含元数据信息',
          default: true
        },
        includeTimestamps: {
          type: 'boolean',
          description: '是否包含时间戳',
          default: true
        },
        sanitize: {
          type: 'boolean',
          description: '是否清理敏感信息',
          default: true
        }
      },
      required: []
    }
  });

  // 命令注册
  ctx.commands.register({
    id: 'export-session',
    name: '导出会话',
    description: '导出当前会话内容',
    usage: '/export-session [options]',
    options: [
      {
        name: 'format',
        alias: 'f',
        type: 'string',
        description: '导出格式 (json, markdown, txt, html)',
        default: 'markdown'
      },
      {
        name: 'output',
        alias: 'o',
        type: 'string',
        description: '输出文件路径',
        default: null
      },
      {
        name: 'no-metadata',
        type: 'boolean',
        description: '不包含元数据信息'
      },
      {
        name: 'no-timestamps',
        type: 'boolean',
        description: '不包含时间戳'
      },
      {
        name: 'no-sanitize',
        type: 'boolean',
        description: '不清理敏感信息'
      }
    ],
    async execute(ctx, options) {
      const {
        format = 'markdown',
        output = null,
        noMetadata = false,
        noTimestamps = false,
        noSanitize = false
      } = options;

      try {
        const sessionData = await collectSessionData(ctx, !noMetadata, !noTimestamps, !noSanitize);
        const content = formatSessionData(sessionData, format, !noMetadata, !noTimestamps);

        if (noSanitize) {
          console.warn('[Session Exporter] 警告：已关闭敏感信息清理，导出内容可能包含密钥等机密信息，请妥善保管导出文件');
        }

        if (output) {
          // 写入文件（路径被限制在当前工作目录内）
          const target = await writeOutputFile(output, content);
          return `会话内容已导出到: ${target}`;
        } else {
          // 直接返回内容
          return content;
        }
      } catch (error) {
        console.error('导出会话失败:', error);
        if (error instanceof SafeError) throw error;
        throw new Error('导出会话失败，详细原因请查看日志');
      }
    }
  });

  // 事件监听
  ctx.on('ready', () => {
    console.log('[Session Exporter] 插件已加载');
  });

  ctx.on('dispose', () => {
    console.log('[Session Exporter] 插件已卸载');
  });
}

/**
 * 收集会话数据
 */
async function collectSessionData(ctx, includeMetadata, includeTimestamps, sanitize) {
  const sessionData = {
    messages: [],
    tools: [],
    commands: []
  };

  // 收集元数据
  if (includeMetadata) {
    sessionData.metadata = {
      startTime: new Date().toISOString(),
      pluginVersion: PLUGIN_VERSION,
      dshVersion: '1.0.0',
      user: maskUser(process.env.USER || process.env.USERNAME || 'unknown')
    };
  }

  // 收集消息历史（这里简化处理，实际需要从 ctx 中获取）
  // 在实际实现中，需要从会话存储中获取历史消息
  if (ctx.session && ctx.session.history) {
    ctx.session.history.forEach((msg, index) => {
      const message = {
        id: index,
        role: msg.role,
        content: msg.content
      };
      if (includeTimestamps) {
        if (msg.timestamp) message.timestamp = msg.timestamp;
      }

      // 清理敏感信息
      if (sanitize) {
        message.content = sanitizeContent(message.content);
      }

      sessionData.messages.push(message);
    });
  }

  // 收集工具使用记录
  if (ctx.tools && ctx.tools.registry) {
    ctx.tools.registry.forEach((tool, id) => {
      sessionData.tools.push({
        id,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      });
    });
  }

  // 收集命令使用记录
  if (ctx.commands && ctx.commands.registry) {
    ctx.commands.registry.forEach((cmd, id) => {
      sessionData.commands.push({
        id,
        name: cmd.name,
        description: cmd.description,
        usage: cmd.usage
      });
    });
  }

  return sessionData;
}

/**
 * 格式化会话数据为指定格式
 */
function formatSessionData(data, format, includeMetadata, includeTimestamps) {
  switch (format.toLowerCase()) {
    case 'json':
      return JSON.stringify(data, null, 2);

    case 'markdown':
      return formatAsMarkdown(data, includeMetadata, includeTimestamps);

    case 'html':
      return formatAsHtml(data, includeMetadata, includeTimestamps);

    case 'txt':
      return formatAsText(data, includeMetadata, includeTimestamps);

    default:
      throw new SafeError(`不支持的格式: ${format}`);
  }
}

/**
 * 格式化为 Markdown
 */
function formatAsMarkdown(data, includeMetadata, includeTimestamps) {
  let md = '';

  // 头部信息
  if (includeMetadata) {
    md += '# 会话内容导出\n\n';
    md += `**导出时间:** ${new Date().toISOString()}\n`;
    if (data.metadata.user) {
      md += `**用户:** ${data.metadata.user}\n`;
    }
    md += `**导出版本:** v${data.metadata.pluginVersion || '1.0.0'}\n\n`;
    md += '---\n\n';
  }

  // 消息历史
  if (data.messages.length > 0) {
    md += '## 消息历史\n\n';
    data.messages.forEach(msg => {
      const timestamp = includeTimestamps && msg.timestamp
        ? `\n*${new Date(msg.timestamp).toLocaleString()}*`
        : '';

      md += `### ${msg.role === 'user' ? '用户' : 'AI'}${timestamp}\n\n`;
      md += `${msg.content}\n\n---\n\n`;
    });
  }

  // 工具列表
  if (data.tools.length > 0) {
    md += '## 可用工具\n\n';
    data.tools.forEach(tool => {
      md += `### ${tool.name}\n\n`;
      md += `${tool.description}\n\n`;
      md += '**参数:**\n\n';
      if (tool.parameters && tool.parameters.properties) {
        Object.entries(tool.parameters.properties).forEach(([key, param]) => {
          md += `- **${key}**: ${param.description} (${param.type})\n`;
        });
      }
      md += '\n---\n\n';
    });
  }

  // 命令列表
  if (data.commands.length > 0) {
    md += '## 可用命令\n\n';
    data.commands.forEach(cmd => {
      md += `### /${cmd.name}\n\n`;
      md += `${cmd.description}\n\n`;
      if (cmd.usage) {
        md += `**用法:** ${cmd.usage}\n\n`;
      }
      md += '\n---\n\n';
    });
  }

  return md;
}

/**
 * 格式化为 HTML
 */
function formatAsHtml(data, includeMetadata, includeTimestamps) {
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>会话内容导出</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; margin: 0; padding: 20px; color: #333; }
        .header { background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .message { margin-bottom: 30px; padding: 20px; border-left: 4px solid #007bff; background-color: #f8f9fa; }
        .message.user { border-left-color: #28a745; }
        .message.ai { border-left-color: #007bff; }
        .message h3 { margin-top: 0; color: #495057; }
        .timestamp { color: #6c757d; font-size: 0.9em; margin-top: 10px; }
        .tool, .command { margin-bottom: 20px; padding: 15px; background-color: #e9ecef; border-radius: 5px; }
        .tool h4, .command h4 { margin-top: 0; }
        .parameters { margin-top: 10px; }
        .parameters ul { margin: 0; padding-left: 20px; }
        hr { border: none; border-top: 1px solid #dee2e6; margin: 30px 0; }
    </style>
</head>
<body>`;

  // 头部信息
  if (includeMetadata) {
    html += `<div class="header">
        <h1>会话内容导出</h1>
        <p><strong>导出时间:</strong> ${new Date().toISOString()}</p>`;
    if (data.metadata.user) {
      html += `<p><strong>用户:</strong> ${escapeHtml(data.metadata.user)}</p>`;
    }
    html += `<p><strong>导出版本:</strong> v${escapeHtml(data.metadata.pluginVersion || '1.0.0')}</p>
    </div>`;
  }

  // 消息历史
  if (data.messages.length > 0) {
    html += '<h2>消息历史</h2>';
    data.messages.forEach(msg => {
      const roleClass = msg.role === 'user' ? 'user' : 'ai';
      html += `
        <div class="message ${roleClass}">
            <h3>${msg.role === 'user' ? '用户' : 'AI'}</h3>
            <div>${escapeHtml(msg.content == null ? '' : msg.content).replace(/\n/g, '<br>')}</div>`;

      if (includeTimestamps && msg.timestamp) {
        html += `<div class="timestamp">${escapeHtml(new Date(msg.timestamp).toLocaleString())}</div>`;
      }

      html += '</div>';
    });
  }

  // 工具列表
  if (data.tools.length > 0) {
    html += '<h2>可用工具</h2>';
    data.tools.forEach(tool => {
      html += `
        <div class="tool">
            <h4>${escapeHtml(tool.name)}</h4>
            <p>${escapeHtml(tool.description)}</p>`;

      if (tool.parameters && tool.parameters.properties) {
        html += '<div class="parameters"><strong>参数:</strong><ul>';
        Object.entries(tool.parameters.properties).forEach(([key, param]) => {
          html += `<li><strong>${escapeHtml(key)}</strong>: ${escapeHtml(param.description)} (${escapeHtml(param.type)})</li>`;
        });
        html += '</ul></div>';
      }

      html += '</div>';
    });
  }

  // 命令列表
  if (data.commands.length > 0) {
    html += '<h2>可用命令</h2>';
    data.commands.forEach(cmd => {
      html += `
        <div class="command">
            <h4>/${escapeHtml(cmd.name)}</h4>
            <p>${escapeHtml(cmd.description)}</p>`;

      if (cmd.usage) {
        html += `<p><strong>用法:</strong> ${escapeHtml(cmd.usage)}</p>`;
      }

      html += '</div>';
    });
  }

  html += '</body></html>';
  return html;
}

/**
 * 格式化为纯文本
 */
function formatAsText(data, includeMetadata, includeTimestamps) {
  let txt = '';

  // 头部信息
  if (includeMetadata) {
    txt += '=== 会话内容导出 ===\n\n';
    txt += `导出时间: ${new Date().toISOString()}\n`;
    if (data.metadata.user) {
      txt += `用户: ${data.metadata.user}\n`;
    }
    txt += `导出版本: v${data.metadata.pluginVersion || '1.0.0'}\n\n`;
    txt += '===================\n\n';
  }

  // 消息历史
  if (data.messages.length > 0) {
    txt += '=== 消息历史 ===\n\n';
    data.messages.forEach(msg => {
      const role = msg.role === 'user' ? '用户' : 'AI';
      const timestamp = includeTimestamps && msg.timestamp
        ? `\n[${new Date(msg.timestamp).toLocaleString()}]`
        : '';

      txt += `${role}${timestamp}:\n${msg.content}\n\n`;
      txt += '---------------\n\n';
    });
  }

  // 工具列表
  if (data.tools.length > 0) {
    txt += '=== 可用工具 ===\n\n';
    data.tools.forEach(tool => {
      txt += `${tool.name}:\n${tool.description}\n\n`;

      if (tool.parameters && tool.parameters.properties) {
        txt += '参数:\n';
        Object.entries(tool.parameters.properties).forEach(([key, param]) => {
          txt += `  - ${key}: ${param.description} (${param.type})\n`;
        });
      }

      txt += '\n---------------\n\n';
    });
  }

  // 命令列表
  if (data.commands.length > 0) {
    txt += '=== 可用命令 ===\n\n';
    data.commands.forEach(cmd => {
      txt += `/${cmd.name}:\n${cmd.description}\n\n`;

      if (cmd.usage) {
        txt += `用法: ${cmd.usage}\n\n`;
      }

      txt += '---------------\n\n';
    });
  }

  return txt;
}

/**
 * 用户名脱敏：保留首尾字符，中间以 * 号掩码
 */
function maskUser(user) {
  if (!user || user === 'unknown') return 'unknown';
  if (user.length <= 2) return user[0] + '*';
  return user[0] + '*'.repeat(Math.min(user.length - 2, 6)) + user[user.length - 1];
}

/**
 * 清理敏感信息
 */
function sanitizeContent(content) {
  content = String(content == null ? '' : content);

  // 清理 PEM 私钥块（必须先于通用模式处理）
  const privateKeyPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
  content = content.replace(privateKeyPattern, '[已清理的私钥]');

  // 清理键值形式的 API 密钥 / 密码 / 令牌
  const apiKeyPattern = /(?:api[_-]?key|secret|token|password)[\s:="']*[a-zA-Z0-9\/\+=\-_.]{16,}/gi;
  content = content.replace(apiKeyPattern, '[已清理的敏感信息]');

  // 清理独立的 OpenAI 风格密钥（sk-...）
  const openAiKeyPattern = /\bsk-[A-Za-z0-9\-_]{20,}\b/g;
  content = content.replace(openAiKeyPattern, '[已清理的密钥]');

  // 清理 JWT（eyJ 开头的三段式令牌）
  const jwtPattern = /\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*\b/g;
  content = content.replace(jwtPattern, '[已清理的令牌]');

  // 清理可能的个人信息
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  content = content.replace(emailPattern, '[已清理的邮箱地址]');

  // 清理可能的电话号码
  const phonePattern = /\b\d{3}[-.\s]?\d{4}[-.\s]?\d{4}\b/g;
  content = content.replace(phonePattern, '[已清理的电话号码]');

  return content;
}