use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct StartupIntent {
    pub action: Option<String>,
    pub path: Option<String>,
}

pub fn startup_intent() -> StartupIntent {
    startup_intent_from_args(std::env::args().skip(1))
}

fn startup_intent_from_args<I, S>(args: I) -> StartupIntent
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut action = None;
    let mut path = None;
    let mut args = args.into_iter().map(Into::into);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--novasvn-action" => {
                action = args.next().and_then(normalize_action);
            }
            "--novasvn-path" => path = args.next().and_then(normalize_startup_path),
            _ if path.is_none() => path = normalize_startup_path(arg),
            _ => {}
        }
    }

    StartupIntent { action, path }
}

fn normalize_action(action: String) -> Option<String> {
    let value = action.trim();
    if matches!(
        value,
        "open" | "commit" | "update" | "diff" | "log" | "revert" | "cleanup" | "branch-workspace"
    ) {
        Some(value.to_string())
    } else {
        None
    }
}

fn normalize_startup_path(path: String) -> Option<String> {
    let value = path.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        None
    } else {
        Some(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_explicit_action_and_path_flags() {
        let intent =
            startup_intent_from_args(["--novasvn-action", "commit", "--novasvn-path", "C:\\wc"]);

        assert_eq!(intent.action.as_deref(), Some("commit"));
        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }

    #[test]
    fn treats_first_plain_arg_as_path() {
        let intent = startup_intent_from_args(["C:\\wc", "--ignored"]);

        assert_eq!(intent.action, None);
        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }

    #[test]
    fn ignores_unknown_startup_actions() {
        let intent =
            startup_intent_from_args(["--novasvn-action", "unknown", "--novasvn-path", "C:\\wc"]);

        assert_eq!(intent.action, None);
        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }

    #[test]
    fn normalizes_startup_paths() {
        let intent = startup_intent_from_args(["--novasvn-path", " C:\\wc "]);

        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }

    #[test]
    fn ignores_blank_or_control_character_startup_paths() {
        let blank = startup_intent_from_args(["--novasvn-path", "   "]);
        let control = startup_intent_from_args(["--novasvn-path", "C:\\wc\nnext"]);

        assert_eq!(blank.path, None);
        assert_eq!(control.path, None);
    }
}
