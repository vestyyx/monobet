# One-off: push app env vars from .env.local to the linked Vercel project (production).
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User');
$local = @{};
Get-Content .env.local | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $local[$matches[1]] = $matches[2] } };

$single = @('DATABASE_URL_UNPOOLED', 'BETTER_AUTH_SECRET', 'SUPER_ADMIN_EMAIL');
foreach ($name in $single) {
  Write-Output $local[$name] | vercel env add $name production 2>&1 | Select-String -Pattern "Added|Error|error|failing" | Select-Object -First 1
}
Write-Output "all-done"
