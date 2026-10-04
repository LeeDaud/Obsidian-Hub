import { describe, expect, it } from 'vitest';
import { noteNameError, noteTargetPath } from './noteNaming';

describe('note naming', () => {
  it.each([
    '',
    'CON',
    'nul.txt',
    'COM1',
    'LPT²',
    'a:b',
    'a/b',
    'a\\b',
    'a*',
    'a?',
    'a.',
    ' a',
    'a ',
    'a\nb',
    '.obsidian',
    'note.md',
  ])('rejects invalid title %s', (title) => {
    expect(noteNameError(title, '')).not.toBeNull();
  });
  it.each(['../', '../outside', '/abs', 'C:/abs', 'a//b', 'a/../b', '.obsidian', 'a\\b', 'a/'])(
    'rejects invalid folder %s',
    (folder) => {
      expect(noteNameError('标题', folder)).not.toBeNull();
    },
  );
  it('preserves Chinese content titles without adding date or stage prefixes', () => {
    expect(noteNameError('收藏行为如何替代学习', '认知/学习')).toBeNull();
    expect(noteTargetPath('收藏行为如何替代学习', '认知/学习')).toBe(
      '认知/学习/收藏行为如何替代学习.md',
    );
  });
});
