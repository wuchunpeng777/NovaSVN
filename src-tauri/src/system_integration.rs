use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct StartupIntent {
    pub action: Option<String>,
    pub path: Option<String>,
}

pub fn startup_intent() -> StartupIntent {
    let mut action = None;
    let mut path = None;
    let mut args = std::env::args().skip(1);

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
