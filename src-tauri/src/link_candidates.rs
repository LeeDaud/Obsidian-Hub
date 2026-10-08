//! Extract bounded literal spans only. Shared TypeScript code interprets link syntax.
use crate::workflow_links::NoteRef;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidates {
    pub owner: NoteRef,
    pub raw: Vec<String>,
    pub truncated: bool,
}

pub fn extract(contents: &str, owner: NoteRef) -> Candidates {
    let mut result = Candidates {
        owner,
        raw: Vec::new(),
        truncated: false,
    };
    let mut fence: Option<(char, usize, usize)> = None;
    let mut inline_ticks = 0;
    let mut comment: Option<&str> = None;
    let mut frontmatter = false;
    for (line_number, line) in contents.trim_start_matches('\u{feff}').lines().enumerate() {
        let skip_links = line.len() > 32768;
        if skip_links {
            result.truncated = true;
        }
        let trimmed = line.trim_start();
        if line_number == 0 && trimmed == "---" {
            frontmatter = true;
            continue;
        }
        if frontmatter {
            if trimmed == "---" {
                frontmatter = false;
            }
            continue;
        }
        if comment.is_none() && inline_ticks == 0 {
            let mut fence_line = trimmed;
            let mut quote_depth = 0;
            while let Some(rest) = fence_line.strip_prefix('>') {
                fence_line = rest.trim_start();
                quote_depth += 1;
            }
            let marker = fence_line.chars().next().unwrap_or(' ');
            let count = fence_line.chars().take_while(|&c| c == marker).count();
            if let Some((kind, length, depth)) = fence {
                if quote_depth == depth
                    && marker == kind
                    && count >= length
                    && fence_line[count..].trim().is_empty()
                {
                    fence = None;
                }
                continue;
            }
            if (marker == '`' || marker == '~') && count >= 3 {
                fence = Some((marker, count, quote_depth));
                continue;
            }
            if line.starts_with("    ") || line.starts_with('\t') {
                continue;
            }
        }
        let mut cursor = 0;
        while cursor < line.len() {
            let rest = &line[cursor..];
            if let Some(close) = comment {
                if let Some(end) = rest.find(close) {
                    cursor += end + close.len();
                    comment = None;
                } else {
                    break;
                }
                continue;
            }
            if inline_ticks == 0 {
                if rest.starts_with("<!--") {
                    comment = Some("-->");
                    cursor += 4;
                    continue;
                }
                if rest.starts_with("%%") {
                    comment = Some("%%");
                    cursor += 2;
                    continue;
                }
            }
            let character = rest.chars().next().unwrap();
            if character == '`' {
                let count = rest.chars().take_while(|&c| c == '`').count();
                if inline_ticks == 0 {
                    inline_ticks = count;
                } else if inline_ticks == count {
                    inline_ticks = 0;
                }
                cursor += count;
                continue;
            }
            let boundary = cursor == 0
                || line[..cursor]
                    .chars()
                    .next_back()
                    .is_some_and(char::is_whitespace);
            if !skip_links
                && inline_ticks == 0
                && (character == '@' || character == '＠')
                && boundary
            {
                let open = match (rest.find("[["), rest.find("【【")) {
                    (Some(a), Some(b)) => Some(a.min(b)),
                    (a, b) => a.or(b),
                };
                if let Some(open) = open {
                    let full = rest[open..].starts_with("【【");
                    let closer = if full { "】】" } else { "]]" };
                    let mut end = open + if full { 6 } else { 2 };
                    let mut escaped = false;
                    let mut found = false;
                    while end < rest.len() {
                        if !escaped && rest[end..].starts_with(closer) {
                            end += closer.len();
                            if end <= 4096 && result.raw.len() < 500 {
                                result.raw.push(rest[..end].to_owned());
                            } else {
                                result.truncated = true;
                            }
                            cursor += end;
                            found = true;
                            break;
                        }
                        let c = rest[end..].chars().next().unwrap();
                        if escaped {
                            escaped = false;
                        } else if c == '\\' {
                            escaped = true;
                        }
                        end += c.len_utf8();
                    }
                    if found {
                        continue;
                    }
                }
            }
            cursor += character.len_utf8();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scan(text: &str) -> Candidates {
        extract(
            text,
            NoteRef {
                vault_id: "echo".into(),
                relative_path: "a.md".into(),
            },
        )
    }
    #[test]
    fn extracts_links_but_excludes_frontmatter_code_and_comments() {
        let text = "---\nexample: @Output[[frontmatter]]\n---\n@Output:o[[article.md#Title|Alias]]\n`@Output[[inline]]`\n````md\n@Output[[fence]]\n```\n@Output[[still fence]]\n````\n<!-- @Output[[comment]]\n@Output[[comment2]] -->\n%% @Output[[obsidian comment]] %%\n    @Output[[indented]]\n> ```md\n> @Output[[quoted code]]\n> ```\n＠Knowledge:k【【资料.md】】\n";
        assert_eq!(
            scan(text).raw,
            [
                "@Output:o[[article.md#Title|Alias]]",
                "＠Knowledge:k【【资料.md】】"
            ]
        );
    }
    #[test]
    fn escaped_closing_brackets_and_malformed_spans_terminate() {
        let result =
            scan("@Output[[escaped\\]name.md]]\n@Output[[unfinished\\]]\n@Output[[valid.md]]");
        assert_eq!(
            result.raw,
            ["@Output[[escaped\\]name.md]]", "@Output[[valid.md]]"]
        );
    }
    #[test]
    fn bounds_large_lines_and_candidate_counts_with_explicit_warning() {
        assert!(scan(&"@ ".repeat(20000)).truncated);
        let result = scan(&"@Output[[a.md]]\n".repeat(501));
        assert_eq!(result.raw.len(), 500);
        assert!(result.truncated);
    }
    #[test]
    fn oversized_lines_still_track_multiline_comment_boundaries() {
        let text = format!(
            "{}<!--\n@Output[[hidden.md]]\n-->\n@Output[[visible.md]]",
            "word ".repeat(7000)
        );
        let result = scan(&text);
        assert!(result.truncated);
        assert_eq!(result.raw, ["@Output[[visible.md]]"]);
    }
}
