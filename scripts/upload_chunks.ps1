$ErrorActionPreference = "Stop"

$ChunksDir = "data\processed\sql_chunks"
$DatabaseName = "linguago-dictionary"

$Files = Get-ChildItem -Path $ChunksDir -Filter "*.sql" | Sort-Object Name

Write-Host "Found $($Files.Count) SQL chunk files to upload to Cloudflare D1."

foreach ($File in $Files) {
    Write-Host "Uploading $($File.Name)..."
    npx wrangler d1 execute $DatabaseName --remote --file=$($File.FullName)
    Write-Host "Successfully uploaded $($File.Name)."
}

Write-Host "All chunks uploaded successfully! D1 Migration Complete! 🎉"
