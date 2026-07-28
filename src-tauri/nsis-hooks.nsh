!define NOVASVN_ROOT_MENU_STATE_CLSID "{0B2DD325-75D0-461D-9FC5-F191AD22FFF6}"
!define NOVASVN_SVN_ONLY_STATE_CLSID "{4D64F10A-B42A-45E5-9034-02F83A16F0AB}"
!define NOVASVN_CHECKOUT_STATE_CLSID "{6A5EA9FB-A012-4F3D-BE8A-07C41CE53B1B}"

Var NovaSvnRestartExplorer
Var NovaSvnActiveShellExtension

!macro NOVASVN_REGISTER_STATE_HANDLER CLSID LABEL
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}" "" "${LABEL}"
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "" "$NovaSvnActiveShellExtension"
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "ThreadingModel" "Apartment"
!macroend

!macro NOVASVN_REGISTER_MENU ROOT
  DeleteRegKey HKCU "${ROOT}\NovaSVN"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "MUIVerb" "NovaSVN"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "SubCommands" ""
  WriteRegStr HKCU "${ROOT}\NovaSVN" "Position" "Bottom"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "SeparatorBefore" ""
  WriteRegStr HKCU "${ROOT}\NovaSVN" "SeparatorAfter" ""
  WriteRegStr HKCU "${ROOT}\NovaSVN" "CommandStateHandler" "${NOVASVN_ROOT_MENU_STATE_CLSID}"
!macroend

!macro NOVASVN_REGISTER_CHECKOUT_ACTION ROOT PATH_PLACEHOLDER
  WriteRegStr HKCU "${ROOT}\NovaSVN.Checkout" "MUIVerb" "NovaSVN Checkout"
  WriteRegStr HKCU "${ROOT}\NovaSVN.Checkout" "Icon" "$INSTDIR\explorer-icons\checkout.ico"
  WriteRegStr HKCU "${ROOT}\NovaSVN.Checkout" "Position" "Bottom"
  WriteRegStr HKCU "${ROOT}\NovaSVN.Checkout" "SeparatorBefore" ""
  WriteRegStr HKCU "${ROOT}\NovaSVN.Checkout" "SeparatorAfter" ""
  WriteRegStr HKCU "${ROOT}\NovaSVN.Checkout" "CommandStateHandler" "${NOVASVN_CHECKOUT_STATE_CLSID}"
  WriteRegStr HKCU "${ROOT}\NovaSVN.Checkout\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"checkout$\" --novasvn-path $\"${PATH_PLACEHOLDER}$\""
!macroend

!macro NOVASVN_REGISTER_ACTION ROOT KEY LABEL ACTION PATH_PLACEHOLDER STATE_HANDLER
  WriteRegStr HKCU "${ROOT}\NovaSVN\shell\${KEY}" "MUIVerb" "${LABEL}"
  WriteRegStr HKCU "${ROOT}\NovaSVN\shell\${KEY}" "Icon" "$INSTDIR\explorer-icons\${ACTION}.ico"
  WriteRegStr HKCU "${ROOT}\NovaSVN\shell\${KEY}" "CommandStateHandler" "${STATE_HANDLER}"
  WriteRegStr HKCU "${ROOT}\NovaSVN\shell\${KEY}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"${ACTION}$\" --novasvn-path $\"${PATH_PLACEHOLDER}$\""
!macroend

!macro NOVASVN_REGISTER_DIRECT_ACTION ROOT KEY LABEL ACTION PATH_PLACEHOLDER
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}" "MUIVerb" "${LABEL}"
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}" "Icon" "$INSTDIR\explorer-icons\${ACTION}.ico"
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}" "Position" "Bottom"
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}" "CommandStateHandler" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"${ACTION}$\" --novasvn-path $\"${PATH_PLACEHOLDER}$\""
!macroend

!macro NOVASVN_MARK_BACKGROUND_CONTEXT ROOT
  WriteRegDWORD HKCU "${ROOT}\NovaSVN" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN.Checkout" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN.Update" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN.Commit" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN.Log" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN\shell\01.Open" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN\shell\02.Info" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN\shell\03.Diff" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN\shell\04.Revert" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN\shell\05.Delete" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN\shell\06.Ignore" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN\shell\07.Cleanup" "ImpliedSelectionModel" 1
  WriteRegDWORD HKCU "${ROOT}\NovaSVN\shell\08.BranchWorkspace" "ImpliedSelectionModel" 1
!macroend

!macro NOVASVN_DELETE_LEGACY_ACTIONS ROOT
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Checkout"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Commit"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Update"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Info"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Log"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Blame"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Open"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Diff"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Revert"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Delete"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Ignore"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Cleanup"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.BranchWorkspace"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.CheckoutOnly"
!macroend

!macro NOVASVN_UNREGISTER_EXPLORER_INTEGRATION
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaSVN"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NovaSVN"
  DeleteRegKey HKCU "Software\Classes\*\shell\NovaSVN"

  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\*\shell"

  DeleteRegKey HKCU "Software\Classes\CLSID\${NOVASVN_ROOT_MENU_STATE_CLSID}"
  DeleteRegKey HKCU "Software\Classes\CLSID\${NOVASVN_SVN_ONLY_STATE_CLSID}"
  DeleteRegKey HKCU "Software\Classes\CLSID\${NOVASVN_CHECKOUT_STATE_CLSID}"
!macroend

!macro NOVASVN_STOP_EXPLORER_FOR_SHELL_EXTENSION
  StrCpy $NovaSvnRestartExplorer "1"
  Push $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM explorer.exe'
  Pop $0
  Pop $0
  Sleep 500
!macroend

!macro NOVASVN_DELETE_INSTALLED_SHELL_EXTENSIONS
  ; 不使用 /REBOOTOK，避免安装完成页进入“重启电脑”流程。
  ; Explorer 已在前置步骤停止，扩展 DLL 应可直接删除。
  Delete "$INSTDIR\shell-extension\novasvn_shell_extension.dll"
  Delete "$INSTDIR\shell-extension\*.tmp.dll"
!macroend

!macro NOVASVN_PREPARE_ACTIVE_SHELL_EXTENSION
  GetTempFileName $NovaSvnActiveShellExtension "$INSTDIR\shell-extension"
  Delete "$NovaSvnActiveShellExtension"
  StrCpy $NovaSvnActiveShellExtension "$NovaSvnActiveShellExtension.dll"
  ClearErrors
  Rename "$INSTDIR\shell-extension\novasvn_shell_extension.pending" "$NovaSvnActiveShellExtension"
  IfErrors 0 novasvn_shell_extension_ready
  MessageBox MB_ICONSTOP|MB_OK "NovaSVN could not prepare its Explorer extension."
  Abort
  novasvn_shell_extension_ready:
!macroend

!macro NOVASVN_NOTIFY_AND_RESTART_EXPLORER
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  StrCmp $NovaSvnRestartExplorer "1" 0 novasvn_explorer_restart_done
  Exec '"$WINDIR\explorer.exe"'
  novasvn_explorer_restart_done:
  ; 清除可能残留的重启标记，保留完成页“是否自动打开”选项。
  SetRebootFlag false
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCpy $NovaSvnRestartExplorer "0"
  IfFileExists "$INSTDIR\shell-extension\novasvn_shell_extension.dll" novasvn_preinstall_extension_found 0
  IfFileExists "$INSTDIR\shell-extension\*.tmp.dll" novasvn_preinstall_extension_found novasvn_preinstall_done
  novasvn_preinstall_extension_found:
  !insertmacro NOVASVN_UNREGISTER_EXPLORER_INTEGRATION
  !insertmacro NOVASVN_STOP_EXPLORER_FOR_SHELL_EXTENSION
  !insertmacro NOVASVN_DELETE_INSTALLED_SHELL_EXTENSIONS
  novasvn_preinstall_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro NOVASVN_PREPARE_ACTIVE_SHELL_EXTENSION
  !insertmacro NOVASVN_REGISTER_STATE_HANDLER "${NOVASVN_ROOT_MENU_STATE_CLSID}" "NovaSVN root menu state"
  !insertmacro NOVASVN_REGISTER_STATE_HANDLER "${NOVASVN_SVN_ONLY_STATE_CLSID}" "NovaSVN working copy state"
  !insertmacro NOVASVN_REGISTER_STATE_HANDLER "${NOVASVN_CHECKOUT_STATE_CLSID}" "NovaSVN checkout state"

  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\*\shell"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "01.Open" "Open" "open" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "02.Info" "SVN Info" "info" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "03.Diff" "Diff" "diff" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "04.Revert" "Revert" "revert" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "05.Delete" "Delete" "delete" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "06.Ignore" "Ignore" "ignore" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "07.Cleanup" "Cleanup" "cleanup" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "08.BranchWorkspace" "Branch Workspace" "branch-workspace" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_CHECKOUT_ACTION "Software\Classes\Directory\shell" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Update" "NovaSVN Update" "update" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Commit" "NovaSVN Commit" "commit" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Log" "NovaSVN Log" "log" "%1"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "01.Open" "Open" "open" "%V" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "02.Info" "SVN Info" "info" "%V" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "03.Diff" "Diff" "diff" "%V" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "04.Revert" "Revert" "revert" "%V" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "05.Delete" "Delete" "delete" "%V" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "06.Ignore" "Ignore" "ignore" "%V" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "07.Cleanup" "Cleanup" "cleanup" "%V" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "08.BranchWorkspace" "Branch Workspace" "branch-workspace" "%V" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_CHECKOUT_ACTION "Software\Classes\Directory\Background\shell" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Update" "NovaSVN Update" "update" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Commit" "NovaSVN Commit" "commit" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Log" "NovaSVN Log" "log" "%V"
  !insertmacro NOVASVN_MARK_BACKGROUND_CONTEXT "Software\Classes\Directory\Background\shell"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\*\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "01.Open" "Open" "open" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "02.Info" "SVN Info" "info" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "03.Diff" "Diff" "diff" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "04.Blame" "Blame" "blame" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "05.Revert" "Revert" "revert" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "06.Delete" "Delete" "delete" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "07.Ignore" "Ignore" "ignore" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "08.Cleanup" "Cleanup" "cleanup" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "09.BranchWorkspace" "Branch Workspace" "branch-workspace" "%1" "${NOVASVN_SVN_ONLY_STATE_CLSID}"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Update" "NovaSVN Update" "update" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Commit" "NovaSVN Commit" "commit" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Log" "NovaSVN Log" "log" "%1"

  !insertmacro NOVASVN_NOTIFY_AND_RESTART_EXPLORER
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $NovaSvnRestartExplorer "0"
  !insertmacro NOVASVN_UNREGISTER_EXPLORER_INTEGRATION
  IfFileExists "$INSTDIR\shell-extension\novasvn_shell_extension.dll" novasvn_preuninstall_extension_found 0
  IfFileExists "$INSTDIR\shell-extension\*.tmp.dll" novasvn_preuninstall_extension_found novasvn_preuninstall_done
  novasvn_preuninstall_extension_found:
  !insertmacro NOVASVN_STOP_EXPLORER_FOR_SHELL_EXTENSION
  !insertmacro NOVASVN_DELETE_INSTALLED_SHELL_EXTENSIONS
  novasvn_preuninstall_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro NOVASVN_NOTIFY_AND_RESTART_EXPLORER
!macroend
