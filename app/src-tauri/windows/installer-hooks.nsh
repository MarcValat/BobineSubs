; NSIS hooks wired in via bundle.windows.nsis.installerHooks (tauri.conf.json),
; from SyncAudio.
;
; The installer's own "is the app running?" check only knows about the main
; exe, not the engine the app launches next to it. An engine left running (a
; crash, a forced kill...) keeps syncsubtitles-engine.exe locked, and
; overwriting or deleting it then fails with "Error opening file for writing".
; nsExec runs taskkill without flashing a console window; a non-zero exit code
; just means no engine was running.

!macro NSIS_HOOK_PREINSTALL
  ; The in-app updater starts this installer and exits at once: Windows then
  ; gives the foreground back to whatever window was behind the app, and this
  ; installer would open behind it. Topmost for an instant, then not
  ; (SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE = 0x13; -1/-2 = HWND_TOPMOST/
  ; HWND_NOTOPMOST).
  BringToFront
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p -1, i 0, i 0, i 0, i 0, i 0x13)'
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p -2, i 0, i 0, i 0, i 0, i 0x13)'
  nsExec::Exec 'taskkill /F /T /IM syncsubtitles-engine.exe'
  Pop $0

  ; SyncSubtitles became Bobine Subs in 1.1.0. The install folder and the
  ; installed-apps entry are keyed on the product name, so this would
  ; install Bobine Subs next to SyncSubtitles rather than over it: the old
  ; install is removed by its own uninstaller. Silent, it never deletes the
  ; app data (settings live under the unchanged identifier); _?= runs it in
  ; place and waits, leaving uninstall.exe and its folder to delete here.
  ; An update (/UPDATE) creates no Start menu shortcut and the old one is
  ; gone with SyncSubtitles, so the new one is created here.
  Push $1
  Push $2
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SyncSubtitles" "InstallLocation"
  StrCpy $2 $1 1
  ${If} $2 == '"'
    StrCpy $1 $1 -1 1
  ${EndIf}
  ${If} $1 != ""
  ${AndIf} ${FileExists} "$1\uninstall.exe"
    ExecWait '"$1\uninstall.exe" /S _?=$1'
    Delete "$1\uninstall.exe"
    ${If} $1 != $INSTDIR
      RMDir "$1"
    ${EndIf}
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}
  Pop $2
  Pop $1
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM syncsubtitles-engine.exe'
  Pop $0
!macroend
