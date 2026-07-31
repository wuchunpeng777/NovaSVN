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

  NSURL *targetURL = [self selectedTargetURL];
  if (!targetURL) {
    return nil;
  }

  NSString *path = targetURL.path;
  BOOL isDirectory = [self pathIsDirectory:path];
  BOOL inWorkingCopy = [self pathIsInWorkingCopy:path];

  // 与 Windows shell 扩展一致：非工作副本仅对目录提供 Checkout
  if (!inWorkingCopy) {
    if (!isDirectory) {
      return nil;
    }
    NSMenu *checkoutMenu = [[NSMenu alloc] initWithTitle:@"NovaSVN"];
    [self addMenuItem:@"Checkout" actionName:@"checkout" toMenu:checkoutMenu];
    return checkoutMenu;
  }

  // 工作副本：与 Windows 相同的顶层常用项 + 子菜单
  // Finder 外层已显示「NovaSVN」，故顶层用短标签（Update / Commit / Log）
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"NovaSVN"];

  [self addMenuItem:@"Update" actionName:@"update" toMenu:menu];
  [self addMenuItem:@"Commit" actionName:@"commit" toMenu:menu];
  [self addMenuItem:@"Log" actionName:@"log" toMenu:menu];

  NSMenuItem *rootItem = [[NSMenuItem alloc] initWithTitle:@"More"
                                                    action:nil
                                             keyEquivalent:@""];
  NSMenu *submenu = [[NSMenu alloc] initWithTitle:@"More"];
  rootItem.submenu = submenu;
  [menu addItem:rootItem];

  // 子菜单项顺序与 windows-explorer-menu.ps1 中 $submenuActions 一致
  [self addMenuItem:@"Open" actionName:@"open" toMenu:submenu];
  [self addMenuItem:@"SVN Info" actionName:@"info" toMenu:submenu];
  [self addMenuItem:@"Diff" actionName:@"diff" toMenu:submenu];
  // Blame 仅对文件（Windows 仅注册在 *\shell）
  if (!isDirectory) {
    [self addMenuItem:@"Blame" actionName:@"blame" toMenu:submenu];
  }
  [self addMenuItem:@"Revert" actionName:@"revert" toMenu:submenu];
  [self addMenuItem:@"Delete" actionName:@"delete" toMenu:submenu];
  [self addMenuItem:@"Ignore" actionName:@"ignore" toMenu:submenu];
  [self addMenuItem:@"Cleanup" actionName:@"cleanup" toMenu:submenu];
  [self addMenuItem:@"Branch Workspace" actionName:@"branch-workspace" toMenu:submenu];
  [self addMenuItem:@"Repo Browser" actionName:@"browse" toMenu:submenu];

  return menu;
}

- (void)addMenuItem:(NSString *)title actionName:(NSString *)actionName toMenu:(NSMenu *)menu {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title
                                                action:@selector(runAction:)
                                         keyEquivalent:@""];
  item.target = self;
  item.representedObject = actionName;
  [menu addItem:item];
}

- (void)runAction:(NSMenuItem *)sender {
  NSString *actionName = (NSString *)sender.representedObject;
  NSURL *targetURL = [self selectedTargetURL];
  if (!actionName || !targetURL) {
    return;
  }

  NSURL *applicationURL = [self novaSVNApplicationURL];
  if (!applicationURL) {
    return;
  }

  NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
  configuration.arguments = @[
    @"--novasvn-action",
    actionName,
    @"--novasvn-path",
    targetURL.path
  ];

  [[NSWorkspace sharedWorkspace] openApplicationAtURL:applicationURL
                                       configuration:configuration
                                   completionHandler:nil];
}

- (NSURL *)selectedTargetURL {
  FIFinderSyncController *controller = [FIFinderSyncController defaultController];
  NSArray<NSURL *> *selectedURLs = controller.selectedItemURLs;
  if (selectedURLs.count > 0) {
    return selectedURLs.firstObject;
  }
  return controller.targetedURL;
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
