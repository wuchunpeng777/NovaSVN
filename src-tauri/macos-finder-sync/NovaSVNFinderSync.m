#import <Cocoa/Cocoa.h>
#import <FinderSync/FinderSync.h>

// Finder 会把本扩展返回的菜单收进以 CFBundleDisplayName（NovaSVN）命名的上级项中。
// 内部层级对齐 Windows：顶层 Update / Commit / Log，其余进子菜单。

@interface NovaSVNFinderSync : FIFinderSync
@end

@implementation NovaSVNFinderSync

- (instancetype)init {
  self = [super init];
  if (self) {
    FIFinderSyncController *controller = [FIFinderSyncController defaultController];
    NSMutableSet<NSURL *> *directories = [NSMutableSet set];
    NSURL *homeURL = [NSURL fileURLWithPath:NSHomeDirectory() isDirectory:YES];
    [directories addObject:homeURL];
    [directories addObject:[NSURL fileURLWithPath:@"/Users" isDirectory:YES]];
    [directories addObject:[NSURL fileURLWithPath:@"/Volumes" isDirectory:YES]];
    controller.directoryURLs = directories;
  }
  return self;
}

- (NSMenu *)menuForMenuKind:(FIMenuKind)menuKind {
  if (menuKind != FIMenuKindContextualMenuForItems &&
      menuKind != FIMenuKindContextualMenuForContainer) {
    return nil;
  }

  // 必须在构建菜单时固化路径：点击菜单项时 selectedItemURLs 常已清空，
  // 若再查询会回退到 targetedURL（上层容器目录），导致打开错误路径。
  NSString *path = [self targetPathForMenuKind:menuKind];
  if (path.length == 0) {
    return nil;
  }

  BOOL isDirectory = [self pathIsDirectory:path];
  BOOL inWorkingCopy = [self pathIsInWorkingCopy:path];

  // 与 Windows shell 扩展一致：非工作副本仅对目录提供 Checkout
  if (!inWorkingCopy) {
    if (!isDirectory) {
      return nil;
    }
    NSMenu *checkoutMenu = [[NSMenu alloc] initWithTitle:@"NovaSVN"];
    [self addMenuItem:@"Checkout" actionName:@"checkout" targetPath:path toMenu:checkoutMenu];
    return checkoutMenu;
  }

  // 工作副本：与 Windows 相同的顶层常用项 + 子菜单
  // Finder 外层已显示「NovaSVN」，故顶层用短标签（Update / Commit / Log）
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"NovaSVN"];

  [self addMenuItem:@"Update" actionName:@"update" targetPath:path toMenu:menu];
  [self addMenuItem:@"Commit" actionName:@"commit" targetPath:path toMenu:menu];
  [self addMenuItem:@"Log" actionName:@"log" targetPath:path toMenu:menu];

  NSMenuItem *rootItem = [[NSMenuItem alloc] initWithTitle:@"More"
                                                    action:nil
                                             keyEquivalent:@""];
  NSMenu *submenu = [[NSMenu alloc] initWithTitle:@"More"];
  rootItem.submenu = submenu;
  [menu addItem:rootItem];

  // 子菜单项顺序与 windows-explorer-menu.ps1 中 $submenuActions 一致
  [self addMenuItem:@"Open" actionName:@"open" targetPath:path toMenu:submenu];
  [self addMenuItem:@"SVN Info" actionName:@"info" targetPath:path toMenu:submenu];
  [self addMenuItem:@"Diff" actionName:@"diff" targetPath:path toMenu:submenu];
  // Blame 仅对文件（Windows 仅注册在 *\shell）
  if (!isDirectory) {
    [self addMenuItem:@"Blame" actionName:@"blame" targetPath:path toMenu:submenu];
  }
  [self addMenuItem:@"Revert" actionName:@"revert" targetPath:path toMenu:submenu];
  [self addMenuItem:@"Delete" actionName:@"delete" targetPath:path toMenu:submenu];
  [self addMenuItem:@"Ignore" actionName:@"ignore" targetPath:path toMenu:submenu];
  [self addMenuItem:@"Cleanup" actionName:@"cleanup" targetPath:path toMenu:submenu];
  [self addMenuItem:@"Branch Workspace" actionName:@"branch-workspace" targetPath:path toMenu:submenu];
  [self addMenuItem:@"Repo Browser" actionName:@"browse" targetPath:path toMenu:submenu];

  return menu;
}

- (void)addMenuItem:(NSString *)title
         actionName:(NSString *)actionName
         targetPath:(NSString *)targetPath
             toMenu:(NSMenu *)menu {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title
                                                action:@selector(runAction:)
                                         keyEquivalent:@""];
  item.target = self;
  // 把 action 与路径一并写入菜单项，避免点击时再解析选中项
  item.representedObject = @{
    @"action" : actionName ?: @"",
    @"path" : targetPath ?: @"",
  };
  // 与 Windows Explorer 菜单共用同一套 action 图标资源
  NSImage *icon = [self menuIconForAction:actionName];
  if (icon) {
    item.image = icon;
  }
  [menu addItem:item];
}

/// 从 appex Resources 加载菜单图标（export-macos-menu-icons.py 从 .ico 导出）
- (NSImage *)menuIconForAction:(NSString *)actionName {
  if (actionName.length == 0) {
    return nil;
  }

  NSBundle *bundle = [NSBundle mainBundle];
  // 优先多分辨率：@1x(16) + @2x(32)；否则回退单文件 action.png
  NSString *path1x = [bundle pathForResource:[NSString stringWithFormat:@"%@@1x", actionName]
                                     ofType:@"png"];
  NSString *path2x = [bundle pathForResource:[NSString stringWithFormat:@"%@@2x", actionName]
                                     ofType:@"png"];
  NSString *pathDefault = [bundle pathForResource:actionName ofType:@"png"];

  NSImage *image = [[NSImage alloc] initWithSize:NSMakeSize(16.0, 16.0)];
  BOOL hasRepresentation = NO;

  if (path1x) {
    NSImage *repImage = [[NSImage alloc] initWithContentsOfFile:path1x];
    NSBitmapImageRep *rep = (NSBitmapImageRep *)repImage.representations.firstObject;
    if ([rep isKindOfClass:[NSBitmapImageRep class]]) {
      rep.size = NSMakeSize(16.0, 16.0);
      [image addRepresentation:rep];
      hasRepresentation = YES;
    }
  }
  if (path2x) {
    NSImage *repImage = [[NSImage alloc] initWithContentsOfFile:path2x];
    NSBitmapImageRep *rep = (NSBitmapImageRep *)repImage.representations.firstObject;
    if ([rep isKindOfClass:[NSBitmapImageRep class]]) {
      rep.size = NSMakeSize(16.0, 16.0);
      [image addRepresentation:rep];
      hasRepresentation = YES;
    }
  }
  if (!hasRepresentation && pathDefault) {
    NSImage *fallback = [[NSImage alloc] initWithContentsOfFile:pathDefault];
    if (fallback) {
      fallback.size = NSMakeSize(16.0, 16.0);
      return fallback;
    }
  }

  return hasRepresentation ? image : nil;
}

- (void)runAction:(NSMenuItem *)sender {
  id payload = sender.representedObject;
  NSString *actionName = nil;
  NSString *targetPath = nil;

  if ([payload isKindOfClass:[NSDictionary class]]) {
    NSDictionary *info = (NSDictionary *)payload;
    actionName = info[@"action"];
    targetPath = info[@"path"];
  } else if ([payload isKindOfClass:[NSString class]]) {
    // 兼容旧菜单项结构
    actionName = (NSString *)payload;
    targetPath = [self targetPathForMenuKind:FIMenuKindContextualMenuForItems];
  }

  if (actionName.length == 0 || targetPath.length == 0) {
    return;
  }

  NSURL *applicationURL = [self novaSVNApplicationURL];
  if (!applicationURL) {
    return;
  }

  NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
  // 必须新开进程：已有主窗口时若复用实例，命令行参数不会生效
  configuration.createsNewApplicationInstance = YES;
  configuration.activates = YES;
  configuration.arguments = @[
    @"--novasvn-action",
    actionName,
    @"--novasvn-path",
    targetPath,
  ];

  [[NSWorkspace sharedWorkspace] openApplicationAtURL:applicationURL
                                       configuration:configuration
                                   completionHandler:^(NSRunningApplication *_Nullable app,
                                                       NSError *_Nullable error) {
                                     if (error) {
                                       NSLog(@"[NovaSVN FinderSync] 启动失败 action=%@ path=%@ error=%@",
                                             actionName, targetPath, error);
                                     } else if (!app) {
                                       NSLog(@"[NovaSVN FinderSync] 启动未返回进程 action=%@ path=%@",
                                             actionName, targetPath);
                                     }
                                   }];
}

/// 按菜单类型解析目标路径。
/// - 文件/文件夹条目：优先 selectedItemURLs（右键选中的项）
/// - 容器空白处：使用 targetedURL（当前文件夹）
- (NSString *)targetPathForMenuKind:(FIMenuKind)menuKind {
  FIFinderSyncController *controller = [FIFinderSyncController defaultController];
  NSURL *url = nil;

  if (menuKind == FIMenuKindContextualMenuForItems) {
    NSArray<NSURL *> *selectedURLs = controller.selectedItemURLs;
    if (selectedURLs.count > 0) {
      url = selectedURLs.firstObject;
    }
    // 部分 Finder 版本在条目菜单里 selected 为空，再回退 targeted
    if (!url) {
      url = controller.targetedURL;
    }
  } else {
    // 容器菜单：空白处右键，目标就是当前目录
    url = controller.targetedURL;
    if (!url) {
      NSArray<NSURL *> *selectedURLs = controller.selectedItemURLs;
      if (selectedURLs.count > 0) {
        url = selectedURLs.firstObject;
      }
    }
  }

  return [self fileSystemPathFromURL:url];
}

/// 将 Finder 可能给出的 file reference / 安全作用域 URL 规范为本地路径字符串
- (NSString *)fileSystemPathFromURL:(NSURL *)url {
  if (!url) {
    return nil;
  }

  NSURL *fileURL = url;
  if ([fileURL respondsToSelector:@selector(filePathURL)]) {
    NSURL *resolved = fileURL.filePathURL;
    if (resolved) {
      fileURL = resolved;
    }
  }

  // 尽量拿到稳定的本地路径（解析符号链接）
  NSURL *standardized = fileURL.URLByResolvingSymlinksInPath ?: fileURL;
  NSString *path = standardized.path;
  if (path.length == 0) {
    path = fileURL.path;
  }
  return path.length > 0 ? path : nil;
}

- (BOOL)pathIsDirectory:(NSString *)path {
  BOOL isDirectory = NO;
  [[NSFileManager defaultManager] fileExistsAtPath:path isDirectory:&isDirectory];
  return isDirectory;
}

/// 自路径向上查找 .svn，与 Windows shell extension 的 classify_path 一致
- (BOOL)pathIsInWorkingCopy:(NSString *)path {
  if (path.length == 0) {
    return NO;
  }

  NSFileManager *fileManager = [NSFileManager defaultManager];
  BOOL isDirectory = NO;
  [fileManager fileExistsAtPath:path isDirectory:&isDirectory];

  NSString *current = isDirectory ? path : [path stringByDeletingLastPathComponent];
  while (current.length > 0) {
    NSString *svnMetadata = [current stringByAppendingPathComponent:@".svn"];
    BOOL svnIsDirectory = NO;
    if ([fileManager fileExistsAtPath:svnMetadata isDirectory:&svnIsDirectory] &&
        svnIsDirectory) {
      return YES;
    }

    NSString *parent = [current stringByDeletingLastPathComponent];
    if ([parent isEqualToString:current] || parent.length == 0) {
      break;
    }
    current = parent;
  }
  return NO;
}

- (NSURL *)novaSVNApplicationURL {
  NSURL *bundleURL = NSBundle.mainBundle.bundleURL;
  NSURL *pluginsURL = bundleURL.URLByDeletingLastPathComponent;
  NSURL *contentsURL = pluginsURL.URLByDeletingLastPathComponent;
  NSURL *applicationURL = contentsURL.URLByDeletingLastPathComponent;
  if ([applicationURL.pathExtension isEqualToString:@"app"]) {
    return applicationURL;
  }

  NSURL *fallbackURL = [NSURL fileURLWithPath:@"/Applications/NovaSVN.app" isDirectory:YES];
  if ([[NSFileManager defaultManager] fileExistsAtPath:fallbackURL.path]) {
    return fallbackURL;
  }

  return nil;
}

@end
