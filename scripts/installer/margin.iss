; Inno Setup script for the Margin · 余白 Windows installer.
; Compiled by scripts/release.mjs on a Windows host with:
;   ISCC.exe /DAppVersion=<version> /DStageDir=<packaged app> /DIconFile=<icon.ico> /O<downloads> /F<output base name> margin.iss
; The installer is per-user (no administrator prompt) and adds Start menu and
; optional desktop shortcuts, so the app is ready to use right after setup.

#ifndef AppVersion
  #error AppVersion is required
#endif

#ifndef StageDir
  #error StageDir is required
#endif

[Setup]
AppId=MarginReader
AppName=Margin · 余白
AppVerName=Margin · 余白 {#AppVersion}
AppVersion={#AppVersion}
AppPublisher=Lazarus-coder
AppPublisherURL=https://github.com/Lazarus-coder/margin-reader
AppSupportURL=https://github.com/Lazarus-coder/margin-reader/issues
DefaultDirName={localappdata}\Programs\Margin
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=Margin-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\Margin.exe
#ifdef IconFile
SetupIconFile={#IconFile}
#endif

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Margin · 余白"; Filename: "{app}\Margin.exe"
Name: "{autodesktop}\Margin · 余白"; Filename: "{app}\Margin.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Margin.exe"; Description: "{cm:LaunchProgram,Margin}"; Flags: nowait postinstall skipifsilent