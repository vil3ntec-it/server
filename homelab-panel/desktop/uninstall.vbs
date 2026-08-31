' ---------------------------------------------------------------------------
'  حذف‌کننده را بدونِ پنجرهٔ سیاه باز می‌کند.
' ---------------------------------------------------------------------------
Option Explicit
Dim fso, shell, here, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
command = "powershell -NoProfile -Sta -ExecutionPolicy Bypass -File """ & here & "\uninstall.ps1"""
shell.Run command, 0, False
