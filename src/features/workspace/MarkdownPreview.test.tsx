import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';

const source = `---
status: draft
tags: [hub, preview]
---
# 标题

第一行 **加粗** 和 \`代码\`
第二行 *强调* 与 ~~删除~~

- 一级
  - [x] 嵌套任务
  - 二级

> 连续引用
> 第二行

| 名称 | 状态 |
| --- | --- |
| Hub | 完成 |

[官网](https://example.com) @Echo:echo-id[[Idea|跨库]]

<script>unsafe()</script>

\`\`\`ts
const value = '<b>safe</b>';
\`\`\`
`;

describe('MarkdownPreview', () => {
  it('renders common Markdown structure while keeping raw HTML inert', () => {
    const onLink = vi.fn();
    const { container } = render(<MarkdownPreview source={source} onLink={onLink} />);
    expect(screen.getByRole('region', { name: '笔记属性' })).toHaveTextContent('status: draft');
    expect(screen.getByRole('heading', { name: '标题' })).toBeVisible();
    expect(screen.getByText('加粗')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getByText('代码')).toHaveProperty('tagName', 'CODE');
    expect(screen.getByRole('checkbox', { name: '嵌套任务' })).toBeChecked();
    expect(screen.getByRole('table')).toBeVisible();
    expect(within(screen.getByRole('blockquote')).getByText(/连续引用/)).toHaveTextContent(
      '连续引用第二行',
    );
    expect(screen.getByRole('link', { name: '官网' })).toHaveAttribute(
      'href',
      'https://example.com/',
    );
    expect(screen.getByRole('button', { name: '跨库' })).toBeVisible();
    expect(screen.getByText('<script>unsafe()</script>')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText("const value = '<b>safe</b>';")).toBeVisible();
  });

  it('does not create navigable links for unsafe protocols', () => {
    render(<MarkdownPreview source="[危险](javascript:alert(1))" onLink={vi.fn()} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('危险')).toBeVisible();
  });
});
