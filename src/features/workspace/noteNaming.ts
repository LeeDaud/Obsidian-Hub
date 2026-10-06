export function validNoteSegment(value: string): boolean {
  const stem = value.split('.')[0].toUpperCase();
  return (
    value.length > 0 &&
    value.length <= 180 &&
    value === value.trim() &&
    !value.startsWith('.') &&
    !value.endsWith('.') &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127 ||
        '<>:"/\\|?*'.includes(character),
    ) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/.test(stem)
  );
}

export function noteNameError(title: string, folder: string): string | null {
  if (!validNoteSegment(title) || title.toLowerCase().endsWith('.md')) {
    return '请输入有效的笔记标题，不含 Windows 特殊字符、首尾空格或 .md 扩展名。';
  }
  if (folder && !folder.split('/').every(validNoteSegment)) {
    return '请输入已有的相对目录，用 / 分隔；不能包含隐藏目录、.. 或首尾斜杠。';
  }
  return null;
}

export function noteTargetPath(title: string, folder: string): string {
  return `${folder ? `${folder}/` : ''}${title}.md`;
}
