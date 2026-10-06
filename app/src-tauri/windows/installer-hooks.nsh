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
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM syncsubtitles-engine.exe'
  Pop $0
!macroend
