Set-Location D:\project\linguago_worker

Write-Host "Unzipping database..."
Expand-Archive -Path linguago.zip -DestinationPath data\processed -Force

Write-Host "Moving script..."
Move-Item -Path llm_augment_sqlite.js -Destination scripts\llm_augment_sqlite.js -Force

Write-Host "Installing dependencies..."
npm install better-sqlite3

Write-Host "Creating batch launcher..."
"cd /d D:\project\linguago_worker && node scripts\llm_augment_sqlite.js > augment_sqlite.log 2>&1" | Out-File run_sqlite.bat -Encoding ASCII

Write-Host "Starting background daemon..."
$proc = [wmiclass]"root\cimv2:Win32_Process"
$result = $proc.Create("cmd.exe /c D:\project\linguago_worker\run_sqlite.bat")
Write-Host "Daemon launched! PID: $($result.ProcessId) Return: $($result.ReturnValue)"
