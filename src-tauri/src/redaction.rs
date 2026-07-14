const REDACTED_VALUE: &str = "<已隐藏>";
const REDACTED_USERINFO: &str = "<凭据>";

const SENSITIVE_KEYS: [&str; 19] = [
    "--config-option",
    "--password",
    "--username",
    "--message",
    "-m",
    "authorization",
    "proxy-password",
    "http-proxy-password",
    "password",
    "passwd",
    "username",
    "access_token",
    "access-token",
    "client_secret",
    "client-secret",
    "api_key",
    "api-key",
    "token",
    "cookie",
];

pub fn redact_credentials(value: &str) -> String {
    redact_sensitive_values(&redact_url_userinfo(value))
}

pub fn redact_url_userinfo(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;

    while let Some(relative_scheme_end) = value[cursor..].find("://") {
        let scheme_end = cursor + relative_scheme_end;
        let authority_start = scheme_end + 3;
        let authority_end = value[authority_start..]
            .char_indices()
            .find_map(|(index, character)| {
                matches!(
                    character,
                    '/' | '?' | '#' | '\r' | '\n' | '\t' | ' ' | '\'' | '"' | '<' | '>' | '`'
                )
                .then_some(authority_start + index)
            })
            .unwrap_or(value.len());
        let authority = &value[authority_start..authority_end];

        if let Some(userinfo_end) = authority.rfind('@') {
            output.push_str(&value[cursor..authority_start]);
            output.push_str(REDACTED_USERINFO);
            output.push('@');
            cursor = authority_start + userinfo_end + 1;
        } else {
            output.push_str(&value[cursor..authority_end]);
            cursor = authority_end;
        }
    }

    output.push_str(&value[cursor..]);
    output
}

fn redact_sensitive_values(value: &str) -> String {
    let lowercase = value.to_ascii_lowercase();
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;

    while let Some((value_start, value_end)) = next_sensitive_value(value, &lowercase, cursor) {
        output.push_str(&value[cursor..value_start]);
        output.push_str(REDACTED_VALUE);
        cursor = value_end;
    }

    output.push_str(&value[cursor..]);
    output
}

fn next_sensitive_value(value: &str, lowercase: &str, cursor: usize) -> Option<(usize, usize)> {
    for (relative_index, _) in lowercase[cursor..].char_indices() {
        let key_start = cursor + relative_index;
        for key in SENSITIVE_KEYS {
            if lowercase[key_start..].starts_with(key) {
                if let Some(range) = sensitive_value_range(value, key_start, key) {
                    return Some(range);
                }
            }
        }
    }
    None
}

fn sensitive_value_range(value: &str, key_start: usize, key: &str) -> Option<(usize, usize)> {
    if !has_key_boundary(value, key_start) {
        return None;
    }

    let is_flag = key.starts_with('-');
    let mut cursor = key_start + key.len();
    if matches!(char_at(value, cursor), Some(('"' | '\'', _))) {
        cursor += 1;
    }

    let separator_start = cursor;
    cursor = skip_ascii_whitespace(value, cursor);
    match char_at(value, cursor) {
        Some(('=' | ':', width)) => {
            cursor += width;
            cursor = skip_ascii_whitespace(value, cursor);
        }
        _ if is_flag && cursor > separator_start => {}
        _ => return None,
    }

    if cursor >= value.len() {
        return None;
    }

    if key == "authorization" {
        let end = value[cursor..]
            .find(['\r', '\n'])
            .map(|index| cursor + index)
            .unwrap_or(value.len());
        return (end > cursor).then_some((cursor, end));
    }

    if let Some((quote @ ('"' | '\''), width)) = char_at(value, cursor) {
        let value_start = cursor + width;
        let value_end = quoted_value_end(value, value_start, quote);
        return (value_end > value_start).then_some((value_start, value_end));
    }

    let value_end = value[cursor..]
        .char_indices()
        .find_map(|(index, character)| {
            (character.is_whitespace()
                || matches!(character, '&' | ',' | ';' | ')' | ']' | '}' | '\'' | '"'))
            .then_some(cursor + index)
        })
        .unwrap_or(value.len());
    (value_end > cursor).then_some((cursor, value_end))
}

fn has_key_boundary(value: &str, key_start: usize) -> bool {
    value[..key_start]
        .chars()
        .next_back()
        .is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
}

fn skip_ascii_whitespace(value: &str, mut cursor: usize) -> usize {
    while let Some((character, width)) = char_at(value, cursor) {
        if !character.is_ascii_whitespace() {
            break;
        }
        cursor += width;
    }
    cursor
}

fn quoted_value_end(value: &str, start: usize, quote: char) -> usize {
    let mut escaped = false;
    for (relative_index, character) in value[start..].char_indices() {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == quote {
            return start + relative_index;
        }
    }
    value.len()
}

fn char_at(value: &str, index: usize) -> Option<(char, usize)> {
    value[index..]
        .chars()
        .next()
        .map(|character| (character, character.len_utf8()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_url_userinfo_and_sensitive_values() {
        let value = concat!(
            "svn: https://url-user:url-password@example.test/repo?password=query-secret&username=query-user\n",
            "command --username cli-user --password=cli-secret --config-option 'servers:global:http-proxy-password=config-secret'\n",
            "debug: \"--password\" \"debug-secret\"\n",
            "json: {\"token\":\"json-token\",\"client_secret\":\"json-secret\"}\n",
            "Authorization: Basic private-authorization"
        );

        let redacted = redact_credentials(value);

        assert!(redacted.contains("https://<凭据>@example.test/repo"));
        assert!(redacted.contains("password=<已隐藏>"));
        assert!(redacted.contains("Authorization: <已隐藏>"));
        for secret in [
            "url-user",
            "url-password",
            "query-secret",
            "query-user",
            "cli-user",
            "cli-secret",
            "config-secret",
            "debug-secret",
            "json-token",
            "json-secret",
            "private-authorization",
        ] {
            assert!(!redacted.contains(secret));
        }
    }

    #[test]
    fn keeps_noncredential_text_unchanged() {
        let value = "认证失败，请检查系统凭据。https://example.test/repository";
        assert_eq!(redact_credentials(value), value);
    }
}
