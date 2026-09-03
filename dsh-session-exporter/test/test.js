/**
 * dsh-session-exporter 测试文件
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { exportSession } from '../index.js';

describe('dsh-session-exporter', () => {
  // 模拟 ctx 对象
  const mockCtx = {
    session: {
      history: [
        {
          role: 'user',
          content: '你好，我想了解如何使用这个插件？'
        },
        {
          role: 'assistant',
          content: '你好！dsh-session-exporter 插件可以帮助你导出会话内容。'
        }
      ]
    },
    tools: {
      registry: new Map([
        ['export-session', {
          name: '导出会话',
          description: '导出当前会话的内容',
          parameters: {
            type: 'object',
            properties: {
              format: { type: 'string', enum: ['json', 'markdown', 'txt', 'html'] }
            }
          }
        }]
      ])
    },
    commands: {
      registry: new Map([
        ['export-session', {
          name: 'export-session',
          description: '导出会话命令',
          usage: '/export-session [options]'
        }]
      ])
    }
  };

  describe('导出功能', () => {
    it('应该能够导出 JSON 格式', async () => {
      const result = await exportSession({
        ctx: mockCtx,
        format: 'json'
      });


      const data = JSON.parse(result);

      // 验证基本结构
      expect(data).to.have.property('metadata');
      expect(data).to.have.property('messages');
      expect(data).to.have.property('tools');
      expect(data).to.have.property('commands');

      // 验证消息数量
      expect(data.messages).to.have.length(2);
    });

    it('应该能够导出 Markdown 格式', async () => {
      const result = await exportSession({
        ctx: mockCtx,
        format: 'markdown'
      });

      expect(result).to.include('# 会话内容导出');
      expect(result).to.include('## 消息历史');
      expect(result).to.include('## 可用工具');
      expect(result).to.include('## 可用命令');
    });

    it('应该能够导出 HTML 格式', async () => {
      const result = await exportSession({
        ctx: mockCtx,
        format: 'html'
      });

      expect(result).to.include('<!DOCTYPE html>');
      expect(result).to.include('<title>会话内容导出</title>');
      expect(result).to.include('<body>');
      expect(result).to.include('<div class="message user">');
    });

    it('应该能够导出纯文本格式', async () => {
      const result = await exportSession({
        ctx: mockCtx,
        format: 'txt'
      });

      expect(result).to.include('=== 会话内容导出 ===');
      expect(result).to.include('=== 消息历史 ===');
      expect(result).to.include('=== 可用工具 ===');
      expect(result).to.include('=== 可用命令 ===');
    });
  });

  describe('参数测试', () => {
    it('应该能够处理不包含元数据的情况', async () => {
      const result = await exportSession({
        ctx: mockCtx,
        format: 'json',
        includeMetadata: false
      });

      const data = JSON.parse(result);
      expect(data).to.not.have.property('metadata');
    });

    it('应该能够处理不包含时间戳的情况', async () => {
      const result = await exportSession({
        ctx: mockCtx,
        format: 'json',
        includeTimestamps: false
      });

      const data = JSON.parse(result);
      expect(data.messages[0]).to.not.have.property('timestamp');
    });

    it('应该能够处理敏感信息清理', async () => {
      const mockCtxWithSensitive = {
        ...mockCtx,
        session: {
          history: [
            {
              role: 'user',
              content: '我的邮箱是 test@example.com，API密钥是 sk-1234567890123456789012345678901234567890'
            }
          ]
        }
      };

      const result = await exportSession({
        ctx: mockCtxWithSensitive,
        format: 'json',
        sanitize: true
      });

      const data = JSON.parse(result);
      expect(data.messages[0].content).to.not.include('test@example.com');
      expect(data.messages[0].content).to.not.include('sk-1234567890123456789012345678901234567890');
      expect(data.messages[0].content).to.include('[已清理的邮箱地址]');
      expect(data.messages[0].content).to.include('[已清理的密钥]');
    });

    it('应该能够处理不清理敏感信息的情况', async () => {
      const mockCtxWithSensitive = {
        ...mockCtx,
        session: {
          history: [
            {
              role: 'user',
              content: '我的邮箱是 test@example.com，API密钥是 sk-1234567890123456789012345678901234567890'
            }
          ]
        }
      };

      const result = await exportSession({
        ctx: mockCtxWithSensitive,
        format: 'json',
        sanitize: false
      });

      expect(result).to.include('[警告] 已关闭敏感信息清理');
      const data = JSON.parse(result.replace(/^\[警告\][^\n]*\n+/, ''));
      expect(data.messages[0].content).to.include('test@example.com');
      expect(data.messages[0].content).to.include('sk-1234567890123456789012345678901234567890');
    });
  });

  describe('错误处理', () => {
    it('应该处理无效的格式', async () => {
      try {
        await exportSession({
          ctx: mockCtx,
          format: 'invalid-format'
        });
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).to.include('不支持的格式');
      }
    });

    it('应该处理空的会话数据', async () => {
      const emptyCtx = {
        session: { history: [] },
        tools: { registry: new Map() },
        commands: { registry: new Map() }
      };

      const result = await exportSession({
        ctx: emptyCtx,
        format: 'json'
      });

      const data = JSON.parse(result);
      expect(data.messages).to.have.length(0);
      expect(data.tools).to.have.length(0);
      expect(data.commands).to.have.length(0);
    });
  });
});

// 辅助函数：从 index.js 导出实际函数
// 这里假设 index.js 会导出必要的函数
const mockExportFunction = async (options) => {
  const { ctx, format = 'json', includeMetadata = true, includeTimestamps = true, sanitize = true } = options;

  // 模拟 collectSessionData 函数
  const collectSessionData = async () => ({
    metadata: includeMetadata ? {
      startTime: new Date().toISOString(),
      pluginVersion: '1.0.0',
      user: 'test-user'
    } : {},
    messages: ctx.session.history.map((msg, index) => ({
      id: index,
      role: msg.role,
      content: sanitize ? sanitizeContent(msg.content) : msg.content,
      timestamp: includeTimestamps ? new Date().toISOString() : null
    })),
    tools: Array.from(ctx.tools.registry).map(([id, tool]) => ({
      id,
      name: tool.name,
      description: tool.description
    })),
    commands: Array.from(ctx.commands.registry).map(([id, cmd]) => ({
      id,
      name: cmd.name,
      description: cmd.description
    }))
  });

  // 模拟 formatSessionData 函数
  const formatSessionData = (data) => {
    switch (format) {
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
  };

  // 模拟格式化函数
  const formatAsMarkdown = (data, includeMetadata, includeTimestamps) => {
    let md = '';
    if (includeMetadata) {
      md += '# 会话内容导出\n\n';
      md += `**导出时间:** ${new Date().toISOString()}\n\n`;
      md += '---\n\n';
    }
    if (data.messages.length > 0) {
      md += '## 消息历史\n\n';
      data.messages.forEach(msg => {
        md += `### ${msg.role === 'user' ? '用户' : 'AI'}\n\n`;
        md += `${msg.content}\n\n---\n\n`;
      });
    }
    return md;
  };

  const formatAsHtml = (data, includeMetadata, includeTimestamps) => {
    return `<!DOCTYPE html>
<html>
<head><title>导出</title></head>
<body>
${includeMetadata ? '<h1>会话内容导出</h1>' : ''}
${data.messages.map(msg => `<div>${msg.role}: ${msg.content}</div>`).join('')}
</body>
</html>`;
  };

  const formatAsText = (data, includeMetadata, includeTimestamps) => {
    let txt = '';
    if (includeMetadata) {
      txt += '=== 会话内容导出 ===\n\n';
    }
    if (data.messages.length > 0) {
      txt += '=== 消息历史 ===\n\n';
      data.messages.forEach(msg => {
        txt += `${msg.role}:\n${msg.content}\n\n`;
      });
    }
    return txt;
  };

  const sanitizeContent = (content) => {
    const apiKeyPattern = /(?:api[_-]?key|secret|token)[\s:]*[a-zA-Z0-9\/\+=]{20,}/gi;
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    content = content.replace(apiKeyPattern, '[已清理的敏感信息]');
    content = content.replace(emailPattern, '[已清理的邮箱地址]');
    return content;
  };

  const data = await collectSessionData();
  return formatSessionData(data);
};

// 导出模拟函数
if (typeof global !== 'undefined') {
  global.exportSession = mockExportFunction;
} else if (typeof window !== 'undefined') {
  window.exportSession = mockExportFunction;
}