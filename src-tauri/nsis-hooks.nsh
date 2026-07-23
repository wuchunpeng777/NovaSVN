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
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "02.Commit" "Commit" "commit" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "03.Update" "Update" "update" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "04.Info" "SVN Info" "info" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\shell" "05.Log" "Log" "log" "%1"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "01.Checkout" "Checkout" "checkout" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "02.Commit" "Commit" "commit" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "03.Update" "Update" "update" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "04.Info" "SVN Info" "info" "%V"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\Directory\Background\shell" "05.Log" "Log" "log" "%V"

  !insertmacro NOVASVN_REGISTER_MENU "Software\Classes\*\shell"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "02.Commit" "Commit" "commit" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "03.Update" "Update" "update" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "04.Info" "SVN Info" "info" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "05.Log" "Log" "log" "%1"
  !insertmacro NOVASVN_REGISTER_ACTION "Software\Classes\*\shell" "06.Blame" "Blame" "blame" "%1"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaSVN"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NovaSVN"
  DeleteRegKey HKCU "Software\Classes\*\shell\NovaSVN"

  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\Directory\Background\shell"
  !insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "Software\Classes\*\shell"
!macroend
