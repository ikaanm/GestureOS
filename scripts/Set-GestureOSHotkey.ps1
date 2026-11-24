[CmdletBinding()]
param(
    [string] $AppPath,
    [switch] $Install,
    [switch] $UseWinC
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (-not $AppPath) {
    $AppPath = Join-Path $project 'src-tauri\target\optimized\release\gestureos.exe'
    if (-not (Test-Path -LiteralPath $AppPath -PathType Leaf)) {
        $AppPath = Join-Path $project 'src-tauri\target\release\gestureos.exe'
    }
}
$AppPath = (Resolve-Path -LiteralPath $AppPath).Path

$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
$outputDirectory = Join-Path $project 'src-tauri\target\hotkey'
$null = New-Item -ItemType Directory -Path $outputDirectory -Force
$launcher = Join-Path $outputDirectory 'GestureOS-Hotkey.exe'
$stagedLauncher = Join-Path $outputDirectory 'GestureOS-Hotkey.new.exe'
$source = Join-Path $PSScriptRoot 'GestureOSHotkey.cs'
& $compiler /nologo /target:winexe /optimize+ "/out:$stagedLauncher" $source
if ($LASTEXITCODE -ne 0) { throw 'Could not compile GestureOS-Hotkey.exe.' }

if ($Install) {
    Get-Process -Name 'GestureOS-Hotkey' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $launcher -and $_.SessionId -eq (Get-Process -Id $PID).SessionId } |
        ForEach-Object {
            Stop-Process -InputObject $_
            if (-not $_.WaitForExit(2000)) { throw 'The old GestureOS hotkey helper is still running.' }
        }
    Move-Item -LiteralPath $stagedLauncher -Destination $launcher -Force
} else {
    Write-Output "Compiled launcher: $stagedLauncher"
    return
}

$arguments = '"' + $AppPath + '"'
if ($UseWinC) { $arguments += ' --win-c' }
$check = Start-Process -FilePath $launcher -ArgumentList "$arguments --check" -WindowStyle Hidden -Wait -PassThru
switch ($check.ExitCode) {
    0 { Write-Output 'Hotkey registration check passed.' }
    3 { Write-Warning 'Windows accepted only Alt + Win + Shift + F23.' }
    4 { Write-Warning 'Windows accepted only Alt + Win + C.' }
    default { throw "Alt + Copilot registration check failed (exit code $($check.ExitCode))." }
}

$startup = [Environment]::GetFolderPath('Startup')
if ($startup) {
    $shortcutPath = Join-Path $startup 'GestureOS Hotkey.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $launcher
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $outputDirectory
    $shortcut.Description = 'Open GestureOS with Right Alt + Copilot'
    $shortcut.Save()

    $running = Start-Process -FilePath $launcher -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if ($running.WaitForExit(500)) { throw "GestureOS Hotkey stopped (exit code $($running.ExitCode))." }
    Write-Output "Started GestureOS Hotkey (PID $($running.Id)). Startup shortcut: $shortcutPath"
}
Write-Output "Launcher: $launcher"
