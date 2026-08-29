/**
 * dsh 会话内容导出插件
 *
 * 该插件提供导出 dsh 会话内容的功能，支持多种格式和导出方式
 */

export const name = 'dsh-session-exporter';

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

        if (output) {
          // 创建目录（如果不存在）
          const fs = await import('fs');
          const path = await import('path');

          const dir = path.dirname(output);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(output, content, 'utf-8');
          return `会话内容已导出到: ${output}`;
        } else {
          // 直接返回内容
          return content;
        }
      } catch (error) {
        console.error('导出会话失败:', error);
        throw new Error(`导出会话失败: ${error.message}`);
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
    metadata: {},
    messages: [],
    tools: [],
    commands: []
  };

  // 收集元数据
  if (includeMetadata) {
    sessionData.metadata = {
      startTime: new Date().toISOString(),
      pluginVersion: '1.0.0',
      dshVersion: '1.0.0',
      user: process.env.USER || process.env.USERNAME || 'unknown'
    };
  }

  // 收集消息历史（这里简化处理，实际需要从 ctx 中获取）
  // 在实际实现中，需要从会话存储中获取历史消息
  if (ctx.session && ctx.session.history) {
    ctx.session.history.forEach((msg, index) => {
      let message = {
        id: index,
        role: msg.role,
        content: msg.content,
        timestamp: includeTimestamps ? new Date().toISOString() : null
      };

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
      throw new Error(`不支持的格式: ${format}`);
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
      html += `<p><strong>用户:</strong> ${data.metadata.user}</p>`;
    }
    html += `<p><strong>导出版本:</strong> v${data.metadata.pluginVersion || '1.0.0'}</p>
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
            <div>${msg.content.replace(/\n/g, '<br>')}</div>`;

      if (includeTimestamps && msg.timestamp) {
        html += `<div class="timestamp">${new Date(msg.timestamp).toLocaleString()}</div>`;
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
            <h4>${tool.name}</h4>
            <p>${tool.description}</p>`;

      if (tool.parameters && tool.parameters.properties) {
        html += '<div class="parameters"><strong>参数:</strong><ul>';
        Object.entries(tool.parameters.properties).forEach(([key, param]) => {
          html += `<li><strong>${key}</strong>: ${param.description} (${param.type})</li>`;
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
            <h4>/${cmd.name}</h4>
            <p>${cmd.description}</p>`;

      if (cmd.usage) {
        html += `<p><strong>用法:</strong> ${cmd.usage}</p>`;
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
 * 清理敏感信息
 */
function sanitizeContent(content) {
  // 清理可能的 API 密钥
  const apiKeyPattern = /(?:api[_-]?key|secret|token|password)[\s:]*[a-zA-Z0-9\/\+=]{20,}/gi;
  content = content.replace(apiKeyPattern, '[已清理的敏感信息]');

  // 清理可能的个人信息
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  content = content.replace(emailPattern, '[已清理的邮箱地址]');

  // 清理可能的电话号码
  const phonePattern = /\b\d{3}[-.\s]?\d{4}[-.\s]?\d{4}\b/g;
  content = content.replace(phonePattern, '[已清理的电话号码]');

  return content;
}