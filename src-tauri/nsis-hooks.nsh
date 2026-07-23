!macro NOVASVN_REGISTER_MENU ROOT
  WriteRegStr HKCU "${ROOT}\NovaSVN" "MUIVerb" "NovaSVN"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "SubCommands" ""
  WriteRegStr HKCU "${ROOT}\NovaSVN" "SeparatorBefore" ""
  WriteRegStr HKCU "${ROOT}\NovaSVN" "SeparatorAfter" ""
!macroend

!macro NOVASVN_REGISTER_ACTION ROOT KEY LABEL ACTION PATH_PLACEHOLDER
  WriteRegStr HKCU "${ROOT}\NovaSVN\shell\${KEY}" "MUIVerb" "${LABEL}"
  WriteRegStr HKCU "${ROOT}\NovaSVN\shell\${KEY}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"${ACTION}$\" --novasvn-path $\"${PATH_PLACEHOLDER}$\""
!macroend

!macro NOVASVN_REGISTER_DIRECT_ACTION ROOT KEY LABEL ACTION PATH_PLACEHOLDER
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}" "MUIVerb" "${LABEL}"
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"${ACTION}$\" --novasvn-path $\"${PATH_PLACEHOLDER}$\""
!macroend

!macro NOVASVN_DELETE_LEGACY_ACTIONS ROOT
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Checkout"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Commit"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Update"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Info"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Log"
  DeleteRegKey HKCU "${ROOT}\NovaSVN.Blame"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\*\shell"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "01.Checkout" "Checkout" "checkout" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "02.Info" "SVN Info" "info" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Open" "Open" "open" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Commit" "Commit" "commit" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Update" "Update" "update" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Diff" "Diff" "diff" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Log" "Log" "log" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Revert" "Revert" "revert" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Cleanup" "Cleanup" "cleanup" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "BranchWorkspace" "Branch Workspace" "branch-workspace" "%1"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "01.Checkout" "Checkout" "checkout" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "02.Info" "SVN Info" "info" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Open" "Open" "open" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Commit" "Commit" "commit" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Update" "Update" "update" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Diff" "Diff" "diff" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Log" "Log" "log" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Revert" "Revert" "revert" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Cleanup" "Cleanup" "cleanup" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "BranchWorkspace" "Branch Workspace" "branch-workspace" "%V"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\*\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "01.Info" "SVN Info" "info" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Open" "Open" "open" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Commit" "Commit" "commit" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Update" "Update" "update" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Diff" "Diff" "diff" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Log" "Log" "log" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Blame" "Blame" "blame" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Revert" "Revert" "revert" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Cleanup" "Cleanup" "cleanup" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "BranchWorkspace" "Branch Workspace" "branch-workspace" "%1"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaSVN"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NovaSVN"
  DeleteRegKey HKCU "Software\Classes\*\shell\NovaSVN"

  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\*\shell"
!macroend
