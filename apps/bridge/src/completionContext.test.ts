import { describe, expect, it } from 'vitest';
import { findCompletionTrigger } from './completionContext';

describe('@ vault completion context', () => {
  it('starts vault selection only at line start or after whitespace', () => {
    expect(findCompletionTrigger('@')).toEqual({
      opener: '@',
      from: 0,
      stage: { kind: 'vault', query: '' },
    });
    expect(findCompletionTrigger('text @Wiki')).toEqual({
      opener: '@',
      from: 5,
      stage: { kind: 'vault', query: 'Wiki' },
    });
    expect(findCompletionTrigger('mail@example.com')).toBeNull();
  });

  it('supports full-width at and enters note selection after the scoped wikilink', () => {
    expect(findCompletionTrigger('＠AAA-Wiki【【TCP')).toEqual({
      opener: '＠',
      from: 0,
      stage: { kind: 'note', vaultName: 'AAA-Wiki', directory: '', query: 'TCP' },
    });
    expect(findCompletionTrigger('@AAA-Wiki[[TCP')).toEqual({
      opener: '@',
      from: 0,
      stage: { kind: 'note', vaultName: 'AAA-Wiki', directory: '', query: 'TCP' },
    });
  });

  it('uses a slash as the interactive transition from vault to note selection', () => {
    expect(findCompletionTrigger('@AAA-Wiki/TCP')).toEqual({
      opener: '@',
      from: 0,
      stage: { kind: 'note', vaultName: 'AAA-Wiki', directory: '', query: 'TCP' },
    });
  });

  it('separates the current directory from its local filter', () => {
    expect(findCompletionTrigger('@AAA-Wiki/Projects/Active/')).toEqual({
      opener: '@',
      from: 0,
      stage: { kind: 'note', vaultName: 'AAA-Wiki', directory: 'Projects/Active', query: '' },
    });
    expect(findCompletionTrigger('@AAA-Wiki/Projects/Active/TCP')).toEqual({
      opener: '@',
      from: 0,
      stage: {
        kind: 'note',
        vaultName: 'AAA-Wiki',
        directory: 'Projects/Active',
        query: 'TCP',
      },
    });
  });

  it('never claims ordinary native wikilinks', () => {
    expect(findCompletionTrigger('[[当前仓库')).toBeNull();
    expect(findCompletionTrigger('text [[当前仓库')).toBeNull();
  });
});
