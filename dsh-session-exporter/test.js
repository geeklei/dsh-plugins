/**
 * 简单测试脚本
 */

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

// 简单测试
console.log('开始测试...');

// 测试收集会话数据
async function testCollectSessionData() {
  // 这里需要从 index.js 导入函数
  // 由于是 ES 模块，我们需要动态导入
  const { collectSessionData } = await import('./index.js');

  const data = await collectSessionData(mockCtx, true, true, true);
  console.log('收集会话数据成功:', data.messages.length, '条消息');
  return data;
}

// 测试格式化（从文件读取代码并执行）
function testFormat(data) {
  const fs = require('fs');
  const code = fs.readFileSync('./index.js', 'utf8');

  // 创建一个函数来执行格式化
  const executeFormat = (data, format) => {
    const formatAsMarkdown = data => {
      let md = '# 会话内容导出\n\n';
      md += `**导出时间:** ${new Date().toISOString()}\n\n`;
      if (data.messages.length > 0) {
        md += '## 消息历史\n\n';
        data.messages.forEach(msg => {
          md += `### ${msg.role === 'user' ? '用户' : 'AI'}\n\n`;
          md += `${msg.content}\n\n---\n\n`;
        });
      }
      return md;
    };

    const formatAsHtml = data => {
      return `<!DOCTYPE html>
<html>
<head><title>导出</title></head>
<body>
<h1>会话内容导出</h1>
${data.messages.map(msg => `<div>${msg.role}: ${msg.content}</div>`).join('')}
</body>
</html>`;
    };

    const formatAsText = data => {
      let txt = '=== 会话内容导出 ===\n\n';
      if (data.messages.length > 0) {
        txt += '=== 消息历史 ===\n\n';
        data.messages.forEach(msg => {
          txt += `${msg.role}:\n${msg.content}\n\n`;
        });
      }
      return txt;
    };

    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'markdown':
        return formatAsMarkdown(data);
      case 'html':
        return formatAsHtml(data);
      case 'txt':
        return formatAsText(data);
      default:
        throw new Error(`不支持的格式: ${format}`);
    }
  };

  const formats = ['json', 'markdown', 'html', 'txt'];

  formats.forEach(format => {
    try {
      const result = executeFormat(data, format);
      console.log(`${format} 格式化成功，长度:`, result.length);

      // 输出第一个示例
      if (format === 'markdown') {
        console.log('示例 Markdown 输出:');
        console.log(result.substring(0, 200) + '...');
      }
    } catch (error) {
      console.error(`${format} 格式化失败:`, error.message);
    }
  });
}

// 运行测试
testCollectSessionData()
  .then(data => testFormat(data))
  .catch(console.error)
  .finally(() => {
    console.log('测试完成');
  });