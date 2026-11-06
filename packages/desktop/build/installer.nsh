; The desktop app's Windows installer customizations (woowtech/README.md section 31, plan G6, D14, D15).
; electron-builder includes build/installer.nsh by itself and compiles it twice, into the
; uninstaller and into the installer, with makensis -WX, so any warning fails the build. Hence no
; Var and no Function here, and registers are saved with Push/Pop (${isUpdated} itself uses $R9).
; Keep this an include: a full nsis.script stops electron-builder from signing the uninstaller.
; NSIS installers cannot be built on the Mac (electron-builder #10258); the Windows build compiles it.

; The defines hold the brand's values. The repository keeps woowtech's; woowtech/tools/apply-brand.mjs
; writes another brand's into them (brandInstallerScript in woowtech/brands/apply.mjs, guard).
; = the scheme under protocols in electron-builder.yml (guard).
!define WOOWTECH_SCHEME "apporosmart"
; = the brand's toast activator CLSID, which src/features/woowtech-app-user-model-id.ts registers
; (guard). The dev build's CLSID is never touched.
!define WOOWTECH_TOAST_CLSID "{88869780-E173-4B34-83FE-B6388E13DED1}"
; = electron-updater's cache folder: extraMetadata.name in lower case, plus "-updater" (guard).
!define WOOWTECH_UPDATER_CACHE "com.apporo.smart.desktop-updater"
; = the brand's CLI command, the name of the trampoline that Install CLI writes (guard).
!define WOOWTECH_CLI_COMMAND "apporo-smart"
; = how the second line of that trampoline starts (src/integrations/cli-install/install.ts, guard).
!define WOOWTECH_CLI_MARKER "rem apporo-smart CLI trampoline"

; D14: Electron registers the toast activator, the Start menu link and the agent-link scheme for
; the current user only, so the app is always installed for the current user. No "Anyone who
; uses this computer" page and no UAC prompt, non-silent updates included.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; D15: a real uninstall removes what Windows keeps pointing at the app, and keeps user data like
; moving the Mac app to the Trash: the app's folder in %APPDATA% and the brand's home folder in
; %USERPROFILE% (agents, pairing keys, worktrees with uncommitted work) stay. The template runs this before it
; removes $INSTDIR, the Start menu link (Electron's link is the same file) and the uninstall entry.
; Every update and reinstall also runs the OLD uninstaller, with --updated; nothing here runs then,
; so updates keep every registration. Installed copies keep this macro until they update, so it
; stays best effort: no Abort, no Quit, no message box.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    Push $3

    ; Agent links (the brand's scheme), if they still open this copy. The app writes "<exe>" "%1"
    ; at startup.
    ReadRegStr $0 HKCU "Software\Classes\${WOOWTECH_SCHEME}\shell\open\command" ""
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
      DeleteRegKey HKCU "Software\Classes\${WOOWTECH_SCHEME}"
    ${endIf}

    ; The toast activator, if it still starts this copy. Electron writes LocalServer32 unquoted.
    ; un.onInit already switched to the 64-bit registry view, where the app wrote it.
    ReadRegStr $0 HKCU "Software\Classes\CLSID\${WOOWTECH_TOAST_CLSID}\LocalServer32" ""
    ${if} $0 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${orIf} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
      DeleteRegKey HKCU "Software\Classes\CLSID\${WOOWTECH_TOAST_CLSID}"
    ${endIf}

    ; Windows' notification settings for the app, created with its first toast.
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\${APP_ID}"

    ; The CLI trampoline from Settings > Install CLI, if it is ours. The .local\bin folder and the
    ; user PATH stay: Claude Code installs claude.exe there.
    StrCpy $0 "$PROFILE\.local\bin\${WOOWTECH_CLI_COMMAND}.cmd"
    ClearErrors
    FileOpen $1 $0 r
    ${ifNot} ${Errors}
      FileRead $1 $2
      FileRead $1 $2
      FileClose $1
      StrLen $3 "${WOOWTECH_CLI_MARKER}"
      StrCpy $2 $2 $3
      ${if} $2 == "${WOOWTECH_CLI_MARKER}"
        Delete $0
      ${endIf}
    ${endIf}

    ; electron-updater's cache: a copy of the installer and any pending download.
    RMDir /r "$LOCALAPPDATA\${WOOWTECH_UPDATER_CACHE}"

    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${endIf}
!macroend
