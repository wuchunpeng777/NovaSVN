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
            "--novasvn-action" => action = args.next(),
            "--novasvn-path" => path = args.next(),
            _ if path.is_none() => path = Some(arg),
            _ => {}
        }
    }

    StartupIntent { action, path }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_explicit_action_and_path_flags() {
        let intent = startup_intent_from_args([
            "--novasvn-action",
            "commit",
            "--novasvn-path",
            "C:\\wc",
        ]);

        assert_eq!(intent.action.as_deref(), Some("commit"));
        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }

    #[test]
    fn treats_first_plain_arg_as_path() {
        let intent = startup_intent_from_args(["C:\\wc", "--ignored"]);

        assert_eq!(intent.action, None);
        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }
}
