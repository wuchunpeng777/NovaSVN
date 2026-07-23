!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Checkout" "MUIVerb" "NovaSVN Checkout"
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Checkout" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Checkout\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"checkout$\" --novasvn-path $\"%1$\""

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Checkout" "MUIVerb" "NovaSVN Checkout"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Checkout" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Checkout\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"checkout$\" --novasvn-path $\"%V$\""

  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Commit" "MUIVerb" "NovaSVN Commit"
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Commit" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Commit\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"commit$\" --novasvn-path $\"%1$\""

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Commit" "MUIVerb" "NovaSVN Commit"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Commit" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Commit\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"commit$\" --novasvn-path $\"%V$\""

  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Commit" "MUIVerb" "NovaSVN Commit"
  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Commit" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Commit\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"commit$\" --novasvn-path $\"%1$\""

  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Update" "MUIVerb" "NovaSVN Update"
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Update" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Update\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"update$\" --novasvn-path $\"%1$\""

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Update" "MUIVerb" "NovaSVN Update"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Update" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Update\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"update$\" --novasvn-path $\"%V$\""

  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Update" "MUIVerb" "NovaSVN Update"
  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Update" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Update\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"update$\" --novasvn-path $\"%1$\""

  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Log" "MUIVerb" "NovaSVN Log"
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Log" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\NovaSVN.Log\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"log$\" --novasvn-path $\"%1$\""

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Log" "MUIVerb" "NovaSVN Log"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Log" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Log\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"log$\" --novasvn-path $\"%V$\""

  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Log" "MUIVerb" "NovaSVN Log"
  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Log" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Log\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"log$\" --novasvn-path $\"%1$\""

  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Blame" "MUIVerb" "NovaSVN Blame"
  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Blame" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\NovaSVN.Blame\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --novasvn-action $\"blame$\" --novasvn-path $\"%1$\""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaSVN.Checkout"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Checkout"

  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaSVN.Commit"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Commit"
  DeleteRegKey HKCU "Software\Classes\*\shell\NovaSVN.Commit"

  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaSVN.Update"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Update"
  DeleteRegKey HKCU "Software\Classes\*\shell\NovaSVN.Update"

  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaSVN.Log"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NovaSVN.Log"
  DeleteRegKey HKCU "Software\Classes\*\shell\NovaSVN.Log"

  DeleteRegKey HKCU "Software\Classes\*\shell\NovaSVN.Blame"
!macroend
