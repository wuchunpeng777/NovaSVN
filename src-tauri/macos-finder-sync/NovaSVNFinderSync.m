#import <Cocoa/Cocoa.h>
#import <FinderSync/FinderSync.h>

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

  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"NovaSVN"];
  [self addMenuItem:@"NovaSVN 打开工作副本" actionName:@"open" toMenu:menu];
  [self addMenuItem:@"NovaSVN 提交" actionName:@"commit" toMenu:menu];
  [self addMenuItem:@"NovaSVN 更新" actionName:@"update" toMenu:menu];
  [self addMenuItem:@"NovaSVN Diff" actionName:@"diff" toMenu:menu];
  [self addMenuItem:@"NovaSVN 日志" actionName:@"log" toMenu:menu];
  [self addMenuItem:@"NovaSVN 撤销" actionName:@"revert" toMenu:menu];
  [self addMenuItem:@"NovaSVN 清理" actionName:@"cleanup" toMenu:menu];
  [self addMenuItem:@"NovaSVN 分支工作区" actionName:@"branch-workspace" toMenu:menu];
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
