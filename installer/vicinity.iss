; Vicinity — установщик Windows-клиента (Inno Setup 6).
; Сборка: ISCC.exe installer\vicinity.iss  → dist\VicinitySetup.exe
; Источник файлов — готовый дистрибутив dist\Vicinity (exe + DLL + qml + plugins).

#define AppName "Vicinity"
#define AppVersion "0.9"
#define AppExe "Vicinity.exe"

[Setup]
AppId={{7E1C51A2-4B7D-4F0E-9C43-VICINITY0001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Vicinity
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=yes
; Без прав администратора — ставится в профиль пользователя (просто для друзей)
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=VicinitySetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExe}

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительно:"

[Files]
Source: "..\dist\Vicinity\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; VC++ Runtime (тихо; если уже стоит — сам выйдет)
Filename: "{app}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; \
    StatusMsg: "Установка Visual C++ Runtime..."; Flags: waituntilterminated skipifdoesntexist
Filename: "{app}\{#AppExe}"; Description: "Запустить {#AppName}"; Flags: nowait postinstall skipifsilent
