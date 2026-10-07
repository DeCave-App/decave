[CmdletBinding()]
param(
    [string]$Source = "",
    [string]$DestinationDirectory = [Environment]::GetFolderPath("Desktop")
)

$ErrorActionPreference = "Stop"

# Windows PowerShell leaves $PSScriptRoot empty in parameter defaults.
if (-not $Source) { $Source = Join-Path $PSScriptRoot "..\.." }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipPath = Join-Path $DestinationDirectory "gamerchat-safe-source-$timestamp.zip"
$staging = Join-Path ([IO.Path]::GetTempPath()) "decave-export-$([Guid]::NewGuid().ToString('N'))"

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Project folder not found: $Source"
}

$excludedDirectories = @(
    "node_modules", "dist", "dist-electron", "coverage", "out", "release", "releases",
    ".git", ".expo", ".vite", ".cache", ".wrangler", ".vercel", "Pods", "backups",
    "uploads", "logs", "crashdumps"
)

$secretExtensions = @(
    ".pfx", ".p12", ".pem", ".key", ".jks", ".keystore", ".p8",
    ".mobileprovision", ".cer", ".crt", ".db", ".sqlite", ".sqlite3", ".log"
)

$secretNames = @(
    ".npmrc", ".dev.vars", "Turn.txt", "credentials.json", "secrets.json",
    "service-account.json", "serviceAccountKey.json", "firebase-service-account.json",
    "google-services.json", "GoogleService-Info.plist", "key.properties",
    "local.properties", "gradle.properties", "auth.json"
)

$textExtensions = @(
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".md",
    ".txt", ".sql", ".toml", ".yaml", ".yml", ".ps1", ".cmd", ".sh", ".xml",
    ".gradle", ".properties"
)

$credentialPatterns = @(
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    '\bAKIA[0-9A-Z]{16}\b',
    '\bgh[pousr]_[A-Za-z0-9]{30,}\b',
    '\bsk_(live|test)_[A-Za-z0-9]{20,}\b',
    '(?im)^\s*(CLOUDFLARE_TURN_API_TOKEN|TURNSTILE_SECRET_KEY|STEAM_WEB_API_KEY|OWNER_MFA_ENCRYPTION_KEY)\s*=\s*\S+'
)

New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
    $sourcePath = (Resolve-Path -LiteralPath $Source).Path.TrimEnd("\")

    Get-ChildItem -LiteralPath $sourcePath -Recurse -Force -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($sourcePath.Length).TrimStart("\")
        $segments = $relativePath -split '\\'
        $name = $_.Name
        $extension = $_.Extension.ToLowerInvariant()

        $isExcludedDirectory = $false
        foreach ($segment in $segments[0..([Math]::Max(0, $segments.Length - 2))]) {
            if ($excludedDirectories -contains $segment) {
                $isExcludedDirectory = $true
                break
            }
        }

        $isGeneratedOrPrivatePath =
            $relativePath -match '(?i)(^|\\)android\\(\.cxx|\.gradle|build|app\\build)(\\|$)' -or
            $relativePath -match '(?i)(^|\\)ios\\build(\\|$)'

        $isEnvironmentFile = $name -ilike ".env*"
        $isSecretExtension = $secretExtensions -contains $extension
        $isSecretName = $secretNames -contains $name
        $isCredentialJson = $name -imatch '^(.*firebase-adminsdk.*|.*service[-_]?account.*|credentials|secrets)\.json$'
        $isSshKey = $name -imatch '^id_(rsa|dsa|ecdsa|ed25519)'
        $isSourceSnapshot =
            $name -imatch '(\.WORKING|\.BEFORE-|\.backup($|\.))' -or
            $name -imatch '^New Text Document\.txt$' -or
            $name -imatch '^android-build-error\.txt$'

        if (
            -not $isExcludedDirectory -and
            -not $isGeneratedOrPrivatePath -and
            -not $isEnvironmentFile -and
            -not $isSecretExtension -and
            -not $isSecretName -and
            -not $isCredentialJson -and
            -not $isSshKey -and
            -not $isSourceSnapshot
        ) {
            $destination = Join-Path $staging $relativePath
            $destinationDirectory = Split-Path -Parent $destination
            New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $destination
        }
    }

    $findings = [System.Collections.Generic.List[string]]::new()
    Get-ChildItem -LiteralPath $staging -Recurse -Force -File | ForEach-Object {
        if ($textExtensions -notcontains $_.Extension.ToLowerInvariant()) { return }
        $content = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop
        foreach ($pattern in $credentialPatterns) {
            if ($content -match $pattern) {
                $findings.Add($_.FullName.Substring($staging.Length).TrimStart("\"))
                break
            }
        }
    }

    if ($findings.Count -gt 0) {
        throw "Potential credential material found in staged files (values hidden): $($findings -join ', ')"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $staging,
        $zipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    Write-Host "Safe source ZIP created:"
    Write-Host $zipPath
}
finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
