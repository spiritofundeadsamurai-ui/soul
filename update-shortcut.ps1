## Creates/updates the "Soul AI" Desktop shortcut to use cmd.exe /k
$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [System.Environment]::GetFolderPath("Desktop")

$Shortcut = $WshShell.CreateShortcut("$Desktop\Soul AI.lnk")
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = '/k "D:\Programer Project\soul\start-soul.bat"'
$Shortcut.WorkingDirectory = "D:\Programer Project\soul"
$Shortcut.Description = "Start Soul AI server"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host "Shortcut updated: $Desktop\Soul AI.lnk"
Write-Host "Target: cmd.exe /k `"D:\Programer Project\soul\start-soul.bat`""
