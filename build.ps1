# ソース (css/, js/) から Build/*.gz を生成する。UTF-8 のまま gzip する。
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$build = Join-Path $root "Build"
$srcCss = Join-Path $root "css\style.css"
$srcJs = Join-Path $root "js\script.js"
$concatJs = Join-Path $root "Build\_framework.concat.js"

if (-not (Test-Path $srcCss)) { throw "Missing: $srcCss" }
if (-not (Test-Path $srcJs)) { throw "Missing: $srcJs" }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# maps/1.png, 2.png, ... を Base64 で束ね、ランタイムで data: URL として使う（ホストに maps を置かなくてよい）
$mapsDir = Join-Path $root "maps"
$mapPairs = New-Object System.Collections.Generic.List[string]
if (Test-Path -LiteralPath $mapsDir) {
    for ($i = 1; $i -le 999; $i++) {
        $mapPath = Join-Path $mapsDir ("{0}.png" -f $i)
        if (-not (Test-Path -LiteralPath $mapPath)) { break }
        $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($mapPath))
        $mapPairs.Add("${i}:`"$b64`"")
    }
}
$embeddedMapsDecl = if ($mapPairs.Count -gt 0) {
    "window.__LABYRINTH_EMBEDDED_MAPS__=Object.freeze({" + ($mapPairs -join ",") + "});`n"
} else {
    "window.__LABYRINTH_EMBEDDED_MAPS__=Object.freeze({});`n"
}

New-Item -ItemType Directory -Force -Path $build | Out-Null
Get-ChildItem -LiteralPath $build -Filter "*.html" -File | Remove-Item -Force

function Write-GZip-File {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestGzPath
    )
    $inStream = [System.IO.File]::OpenRead($SourcePath)
    try {
        $outStream = [System.IO.File]::Create($DestGzPath)
        try {
            $gzip = New-Object System.IO.Compression.GZipStream(
                $outStream,
                [System.IO.Compression.CompressionMode]::Compress
            )
            try {
                $inStream.CopyTo($gzip)
            }
            finally {
                $gzip.Dispose()
            }
        }
        finally {
            $outStream.Dispose()
        }
    }
    finally {
        $inStream.Dispose()
    }
}

Write-GZip-File -SourcePath $srcCss -DestGzPath (Join-Path $build "labyrinth.data.gz")

$bundleText = $embeddedMapsDecl + [System.IO.File]::ReadAllText($srcJs, $utf8NoBom)
[System.IO.File]::WriteAllText($concatJs, $bundleText, $utf8NoBom)
Write-GZip-File -SourcePath $concatJs -DestGzPath (Join-Path $build "labyrinth.framework.js.gz")
Remove-Item -LiteralPath $concatJs -Force

# Unity の codeUrl に相当するプレースホルダ（1 バイトの gzip。ローダーは展開して破棄）
$wasmGz = Join-Path $build "labyrinth.wasm.gz"
$outW = [System.IO.File]::Create($wasmGz)
try {
    $gzW = New-Object System.IO.Compression.GZipStream(
        $outW,
        [System.IO.Compression.CompressionMode]::Compress
    )
    try {
        $gzW.Write([byte[]]@(0), 0, 1)
    }
    finally {
        $gzW.Dispose()
    }
}
finally {
    $outW.Dispose()
}

Write-Host "Build OK:" $build "embedded maps:" $mapPairs.Count
