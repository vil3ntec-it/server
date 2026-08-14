' ---------------------------------------------------------------------------
'  پنل را کاملاً بی‌پنجره اجرا می‌کند (نه پنجرهٔ سیاه، نه چیزی روی نوار وظیفه).
'  با بستن هر ترمینالی، سرور به کارش ادامه می‌دهد.
' ---------------------------------------------------------------------------
Option Explicit
Dim fso, shell, here
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
' 0 = پنهان، False = منتظر پایانش نمی‌مانیم
shell.Run """" & here & "\run-quiet.bat""", 0, False
