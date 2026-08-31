' ---------------------------------------------------------------------------
'  برنامهٔ سرور خانگی را باز می‌کند — بدونِ هیچ پنجرهٔ سیاهی، حتی یک لحظه.
'  میان‌برِ روی دسکتاپ به همین فایل اشاره می‌کند.
' ---------------------------------------------------------------------------
Option Explicit
Dim fso, shell, here, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here

command = "powershell -NoProfile -Sta -ExecutionPolicy Bypass -File """ & here & "\app.ps1"""
' 0 = پنهان، False = منتظرش نمی‌مانیم
shell.Run command, 0, False
