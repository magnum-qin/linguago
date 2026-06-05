$proc = [wmiclass]"root\cimv2:Win32_Process"
$result = $proc.Create("cmd.exe /c cd /d D:\project\linguago_worker && node scripts\llm_augment.js > augment.log 2>&1")
Write-Output "Launch Result: $($result.ReturnValue) Process ID: $($result.ProcessId)"
