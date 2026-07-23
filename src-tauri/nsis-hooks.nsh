!macro NOVASVN_REGISTER_MENU ROOT
  DeleteRegKey HKCU "${ROOT}\NovaSVN"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "MUIVerb" "NovaSVN"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${ROOT}\NovaSVN" "SubCommands" ""
  WriteRegStr HKCU "${ROOT}\NovaSVN" "Position" "Bottom"
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
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}" "Position" "Bottom"
  WriteRegStr HKCU "${ROOT}\NovaSVN.${KEY}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"${ACTION}$\" --novasvn-path $\"${PATH_PLACEHOLDER}$\""
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
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\*\shell"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "01.Open" "Open" "open" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "02.Checkout" "Checkout" "checkout" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "03.Info" "SVN Info" "info" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "04.Diff" "Diff" "diff" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "05.Revert" "Revert" "revert" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "06.Delete" "Delete" "delete" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "07.Ignore" "Ignore" "ignore" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "08.Cleanup" "Cleanup" "cleanup" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "09.BranchWorkspace" "Branch Workspace" "branch-workspace" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Update" "NovaSVN Update" "update" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Commit" "NovaSVN Commit" "commit" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\shell" "Log" "NovaSVN Log" "log" "%1"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "01.Open" "Open" "open" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "02.Checkout" "Checkout" "checkout" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "03.Info" "SVN Info" "info" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "04.Diff" "Diff" "diff" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "05.Revert" "Revert" "revert" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "06.Delete" "Delete" "delete" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "07.Ignore" "Ignore" "ignore" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "08.Cleanup" "Cleanup" "cleanup" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "09.BranchWorkspace" "Branch Workspace" "branch-workspace" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Update" "NovaSVN Update" "update" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Commit" "NovaSVN Commit" "commit" "%V"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\Directory\Background\shell" "Log" "NovaSVN Log" "log" "%V"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\*\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "01.Open" "Open" "open" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "02.Info" "SVN Info" "info" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "03.Diff" "Diff" "diff" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "04.Blame" "Blame" "blame" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "05.Revert" "Revert" "revert" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "06.Delete" "Delete" "delete" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "07.Ignore" "Ignore" "ignore" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "08.Cleanup" "Cleanup" "cleanup" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "09.BranchWorkspace" "Branch Workspace" "branch-workspace" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Update" "NovaSVN Update" "update" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Commit" "NovaSVN Commit" "commit" "%1"
  !insertmacro NOVASVN_REGISTER_DIRECT_ACTION "Software\Classes\*\shell" "Log" "NovaSVN Log" "log" "%1"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaSVN"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NovaSVN"
  DeleteRegKey HKCU "Software\Classes\*\shell\NovaSVN"

  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\*\shell"
!macroend
