!include "LogicLib.nsh"

!macro customInstall
  SetRegView 32
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Major"
  ReadRegDWORD $2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"

  ${If} $0 == 1
    ${If} $1 > 14
      Goto cairn_vc_runtime_ready
    ${ElseIf} $1 == 14
      ${If} $2 >= 43
        Goto cairn_vc_runtime_ready
      ${EndIf}
    ${EndIf}
  ${EndIf}

  DetailPrint "Installing the Microsoft Visual C++ x64 runtime required by the Cairn Codex live adapter."
  ExecWait '"$INSTDIR\resources\prerequisites\vc_redist.x64.exe" /install /quiet /norestart' $0
  ${If} $0 == 0
    Goto cairn_vc_runtime_ready
  ${ElseIf} $0 == 1638
    Goto cairn_vc_runtime_ready
  ${ElseIf} $0 == 3010
    SetRebootFlag true
    Goto cairn_vc_runtime_ready
  ${EndIf}

  MessageBox MB_ICONSTOP|MB_OK "The Microsoft Visual C++ x64 runtime could not be installed (exit code $0). Cairn Codex was not fully installed."
  Abort

  cairn_vc_runtime_ready:
!macroend
