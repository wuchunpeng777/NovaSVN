use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use windows::core::{implement, ComObject, IUnknown, Interface, Ref, Result, BOOL, GUID, HRESULT};
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_POINTER, S_FALSE, S_OK,
};
use windows::Win32::System::Com::{CoTaskMemFree, IClassFactory, IClassFactory_Impl};
use windows::Win32::UI::Shell::{
    IExplorerCommandState, IExplorerCommandState_Impl, IShellItemArray, ECS_ENABLED, ECS_HIDDEN,
    SIGDN_FILESYSPATH,
};

pub const ROOT_MENU_STATE_CLSID: GUID = GUID::from_u128(0x0b2dd325_75d0_461d_9fc5_f191ad22fff6);
pub const SVN_ONLY_STATE_CLSID: GUID = GUID::from_u128(0x4d64f10a_b42a_45e5_9034_02f83a16f0ab);
pub const CHECKOUT_STATE_CLSID: GUID = GUID::from_u128(0x6a5ea9fb_a012_4f3d_be8a_07c41ce53b1b);

static ACTIVE_OBJECTS: AtomicU32 = AtomicU32::new(0);
static SERVER_LOCKS: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StateKind {
    RootMenu,
    SvnOnly,
    Checkout,
}

impl StateKind {
    fn from_clsid(clsid: &GUID) -> Option<Self> {
        match *clsid {
            ROOT_MENU_STATE_CLSID => Some(Self::RootMenu),
            SVN_ONLY_STATE_CLSID => Some(Self::SvnOnly),
            CHECKOUT_STATE_CLSID => Some(Self::Checkout),
            _ => None,
        }
    }

    fn is_visible(self, paths: &[PathState]) -> bool {
        if paths.is_empty() {
            return false;
        }

        let all_in_working_copy = paths.iter().all(|path| path.in_working_copy);
        let checkout_available = paths
            .iter()
            .all(|path| path.is_directory && !path.in_working_copy);

        match self {
            Self::RootMenu => all_in_working_copy,
            Self::SvnOnly => all_in_working_copy,
            Self::Checkout => checkout_available,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PathState {
    is_directory: bool,
    in_working_copy: bool,
}

fn classify_path(path: &Path) -> PathState {
    let is_directory = path.is_dir();
    let start = if is_directory {
        Some(path)
    } else {
        path.parent()
    };
    let in_working_copy = start
        .into_iter()
        .flat_map(Path::ancestors)
        .any(|directory| directory.join(".svn").is_dir());

    PathState {
        is_directory,
        in_working_copy,
    }
}

fn selected_paths(items: &IShellItemArray) -> Option<Vec<PathBuf>> {
    unsafe {
        let count = items.GetCount().ok()?;
        if count == 0 {
            return None;
        }

        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let item = items.GetItemAt(index).ok()?;
            let display_name = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let path = display_name.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(display_name.0.cast()));
            paths.push(path?);
        }
        Some(paths)
    }
}

#[implement(IExplorerCommandState)]
struct StateHandler {
    kind: StateKind,
}

impl StateHandler {
    fn new(kind: StateKind) -> Self {
        ACTIVE_OBJECTS.fetch_add(1, Ordering::Relaxed);
        Self { kind }
    }
}

impl Drop for StateHandler {
    fn drop(&mut self) {
        ACTIVE_OBJECTS.fetch_sub(1, Ordering::Release);
    }
}

#[allow(non_snake_case)]
impl IExplorerCommandState_Impl for StateHandler_Impl {
    fn GetState(&self, items: Ref<'_, IShellItemArray>, _ok_to_be_slow: BOOL) -> Result<u32> {
        let visible = items
            .ok()
            .ok()
            .and_then(selected_paths)
            .map(|paths| {
                let states = paths
                    .iter()
                    .map(|path| classify_path(path))
                    .collect::<Vec<_>>();
                self.kind.is_visible(&states)
            })
            .unwrap_or(false);

        Ok(if visible {
            ECS_ENABLED.0 as u32
        } else {
            ECS_HIDDEN.0 as u32
        })
    }
}

#[implement(IClassFactory)]
struct ClassFactory {
    kind: StateKind,
}

impl ClassFactory {
    fn new(kind: StateKind) -> Self {
        ACTIVE_OBJECTS.fetch_add(1, Ordering::Relaxed);
        Self { kind }
    }
}

impl Drop for ClassFactory {
    fn drop(&mut self) {
        ACTIVE_OBJECTS.fetch_sub(1, Ordering::Release);
    }
}

#[allow(non_snake_case)]
impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<'_, IUnknown>,
        interface_id: *const GUID,
        result: *mut *mut c_void,
    ) -> Result<()> {
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        if interface_id.is_null() || result.is_null() {
            return Err(E_POINTER.into());
        }

        unsafe {
            *result = std::ptr::null_mut();
            let handler: IExplorerCommandState =
                ComObject::new(StateHandler::new(self.kind)).into_interface();
            handler.query(interface_id, result).ok()
        }
    }

    fn LockServer(&self, lock: BOOL) -> Result<()> {
        if lock.as_bool() {
            SERVER_LOCKS.fetch_add(1, Ordering::Relaxed);
        } else {
            SERVER_LOCKS
                .fetch_update(Ordering::Release, Ordering::Relaxed, |locks| {
                    locks.checked_sub(1)
                })
                .ok();
        }
        Ok(())
    }
}

#[no_mangle]
#[allow(non_snake_case)]
/// Returns a class factory for one of NovaSVN's registered command state handlers.
///
/// # Safety
///
/// COM must provide valid `class_id` and `interface_id` pointers and a writable `result` pointer.
pub unsafe extern "system" fn DllGetClassObject(
    class_id: *const GUID,
    interface_id: *const GUID,
    result: *mut *mut c_void,
) -> HRESULT {
    if class_id.is_null() || interface_id.is_null() || result.is_null() {
        return E_POINTER;
    }
    *result = std::ptr::null_mut();

    let Some(kind) = StateKind::from_clsid(&*class_id) else {
        return CLASS_E_CLASSNOTAVAILABLE;
    };
    let factory: IClassFactory = ComObject::new(ClassFactory::new(kind)).into_interface();
    factory.query(interface_id, result)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if ACTIVE_OBJECTS.load(Ordering::Acquire) == 0 && SERVER_LOCKS.load(Ordering::Acquire) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItem, SHCreateItemFromParsingName, SHCreateShellItemArrayFromShellItem,
    };

    struct TestTree(PathBuf);

    struct ComApartment;

    impl ComApartment {
        fn new() -> Self {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                    .ok()
                    .expect("initialize COM apartment");
            }
            Self
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    impl TestTree {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "novasvn-shell-extension-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test tree");
            Self(path)
        }
    }

    impl Drop for TestTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn classifies_nested_working_copy_paths() {
        let tree = TestTree::new();
        let working_copy = tree.0.join("working-copy");
        let nested = working_copy.join("src").join("nested");
        let file = nested.join("main.rs");
        fs::create_dir_all(working_copy.join(".svn")).expect("create metadata directory");
        fs::create_dir_all(&nested).expect("create nested directory");
        fs::write(&file, "fn main() {}\n").expect("create nested file");

        assert_eq!(
            classify_path(&working_copy),
            PathState {
                is_directory: true,
                in_working_copy: true,
            }
        );
        assert_eq!(classify_path(&nested), classify_path(&working_copy));
        assert_eq!(
            classify_path(&file),
            PathState {
                is_directory: false,
                in_working_copy: true,
            }
        );
    }

    #[test]
    fn classifies_non_working_copy_file_and_directory() {
        let tree = TestTree::new();
        let directory = tree.0.join("plain-directory");
        let file = directory.join("plain.txt");
        fs::create_dir_all(&directory).expect("create plain directory");
        fs::write(&file, "plain\n").expect("create plain file");

        assert_eq!(
            classify_path(&directory),
            PathState {
                is_directory: true,
                in_working_copy: false,
            }
        );
        assert_eq!(
            classify_path(&file),
            PathState {
                is_directory: false,
                in_working_copy: false,
            }
        );
    }

    #[test]
    fn exposes_separate_working_copy_and_checkout_menus() {
        let working_copy_directory = PathState {
            is_directory: true,
            in_working_copy: true,
        };
        let plain_directory = PathState {
            is_directory: true,
            in_working_copy: false,
        };
        let plain_file = PathState {
            is_directory: false,
            in_working_copy: false,
        };

        assert!(StateKind::SvnOnly.is_visible(&[working_copy_directory]));
        assert!(!StateKind::Checkout.is_visible(&[working_copy_directory]));
        assert!(StateKind::RootMenu.is_visible(&[working_copy_directory]));

        assert!(!StateKind::SvnOnly.is_visible(&[plain_directory]));
        assert!(StateKind::Checkout.is_visible(&[plain_directory]));
        assert!(!StateKind::RootMenu.is_visible(&[plain_directory]));

        assert!(!StateKind::SvnOnly.is_visible(&[plain_file]));
        assert!(!StateKind::Checkout.is_visible(&[plain_file]));
        assert!(!StateKind::RootMenu.is_visible(&[plain_file]));
    }

    #[test]
    fn exported_com_factory_evaluates_real_shell_items() {
        let _com = ComApartment::new();
        let tree = TestTree::new();
        let working_copy = tree.0.join("working-copy");
        let plain_directory = tree.0.join("plain-directory");
        let plain_file = plain_directory.join("plain.txt");
        fs::create_dir_all(working_copy.join(".svn")).expect("create metadata directory");
        fs::create_dir_all(&plain_directory).expect("create plain directory");
        fs::write(&plain_file, "plain\n").expect("create plain file");

        assert_eq!(
            command_state(SVN_ONLY_STATE_CLSID, &working_copy),
            ECS_ENABLED.0 as u32
        );
        assert_eq!(
            command_state(CHECKOUT_STATE_CLSID, &working_copy),
            ECS_HIDDEN.0 as u32
        );
        assert_eq!(
            command_state(CHECKOUT_STATE_CLSID, &plain_directory),
            ECS_ENABLED.0 as u32
        );
        assert_eq!(
            command_state(ROOT_MENU_STATE_CLSID, &plain_directory),
            ECS_HIDDEN.0 as u32
        );
        assert_eq!(
            command_state(ROOT_MENU_STATE_CLSID, &plain_file),
            ECS_HIDDEN.0 as u32
        );
    }

    fn command_state(class_id: GUID, path: &Path) -> u32 {
        unsafe {
            let mut class_factory = std::ptr::null_mut();
            DllGetClassObject(&class_id, &IClassFactory::IID, &mut class_factory)
                .ok()
                .expect("create class factory");
            let class_factory = IClassFactory::from_raw(class_factory);
            let handler: IExplorerCommandState = class_factory
                .CreateInstance(None)
                .expect("create state handler");

            let path = HSTRING::from(path.as_os_str().to_string_lossy().as_ref());
            let item: IShellItem =
                SHCreateItemFromParsingName(&path, None).expect("create shell item");
            let items: IShellItemArray =
                SHCreateShellItemArrayFromShellItem(&item).expect("create shell item array");
            handler.GetState(&items, false).expect("read command state")
        }
    }
}
