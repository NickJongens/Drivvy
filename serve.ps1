param(
  [int]$Port = 8080,
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$DataDirectory = Join-Path $Root "data"
$HighScoresPath = Join-Path $DataDirectory "highscores.json"
$MaxScores = 250

function Get-ContentType {
  param([string]$Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".js" { return "application/javascript; charset=utf-8" }
    ".mjs" { return "application/javascript; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".wasm" { return "application/wasm" }
    ".png" { return "image/png" }
    ".jpg" { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".svg" { return "image/svg+xml" }
    default { return "application/octet-stream" }
  }
}

function Write-BytesResponse {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$StatusCode,
    [string]$ContentType,
    [byte[]]$Bytes,
    [bool]$SkipBody = $false
  )

  $Response.StatusCode = $StatusCode
  $Response.ContentType = $ContentType
  $Response.ContentLength64 = $Bytes.Length

  if (-not $SkipBody -and $Bytes.Length -gt 0) {
    $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
  }
}

function Write-TextResponse {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$StatusCode,
    [string]$Text,
    [string]$ContentType = "text/plain; charset=utf-8",
    [bool]$SkipBody = $false
  )

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  Write-BytesResponse -Response $Response -StatusCode $StatusCode -ContentType $ContentType -Bytes $bytes -SkipBody $SkipBody
}

function Read-RequestBytes {
  param([System.Net.HttpListenerRequest]$Request)

  if ($Request.ContentLength64 -eq 0) {
    return [byte[]]@()
  }

  $memoryStream = New-Object System.IO.MemoryStream
  try {
    $Request.InputStream.CopyTo($memoryStream)
    return $memoryStream.ToArray()
  } finally {
    $memoryStream.Dispose()
  }
}

function Ensure-HighScoresFile {
  if (-not (Test-Path $DataDirectory -PathType Container)) {
    [System.IO.Directory]::CreateDirectory($DataDirectory) | Out-Null
  }

  if (-not (Test-Path $HighScoresPath -PathType Leaf)) {
    [System.IO.File]::WriteAllText($HighScoresPath, "{`"scores`":[]}", [System.Text.Encoding]::UTF8)
  }
}

function Get-HighScoreStore {
  Ensure-HighScoresFile
  $raw = [System.IO.File]::ReadAllText($HighScoresPath)

  if ([string]::IsNullOrWhiteSpace($raw)) {
    return @{ scores = @() }
  }

  try {
    $data = $raw | ConvertFrom-Json
  } catch {
    return @{ scores = @() }
  }

  if ($null -eq $data -or $null -eq $data.scores) {
    return @{ scores = @() }
  }

  return @{ scores = @($data.scores) }
}

function Save-HighScoreStore {
  param($Store)

  Ensure-HighScoresFile
  $payload = @{ scores = @($Store.scores) } | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($HighScoresPath, $payload, [System.Text.Encoding]::UTF8)
}

function Normalize-HighScoreEntry {
  param($InputObject)

  $trimmedName = [regex]::Replace(([string]$InputObject.name).Trim(), "\s+", " ")
  if ([string]::IsNullOrWhiteSpace($trimmedName)) {
    $trimmedName = "Guest"
  }
  if ($trimmedName.Length -gt 18) {
    $trimmedName = $trimmedName.Substring(0, 18)
  }

  $distance = 0
  try {
    $distance = [int][math]::Round([double]$InputObject.distance)
  } catch {
    $distance = 0
  }
  if ($distance -lt 0) {
    $distance = 0
  }

  $weather = ([string]$InputObject.weather).Trim()
  if ([string]::IsNullOrWhiteSpace($weather)) {
    $weather = "Clear"
  }
  if ($weather.Length -gt 24) {
    $weather = $weather.Substring(0, 24)
  }

  $aiEnabled = $false
  if ($null -ne $InputObject.aiEnabled) {
    $aiEnabled = [bool]$InputObject.aiEnabled
  } elseif ($null -ne $InputObject.aiMode) {
    $aiEnabled = [bool]$InputObject.aiMode
  }

  return @{
    id = [guid]::NewGuid().ToString("N")
    name = $trimmedName
    distance = $distance
    aiEnabled = $aiEnabled
    weather = $weather
    createdAt = [DateTime]::UtcNow.ToString("o")
  }
}

function Handle-HighScoresRequest {
  param([System.Net.HttpListenerContext]$Context)

  $method = $Context.Request.HttpMethod.ToUpperInvariant()
  $skipBody = $method -eq "HEAD"

  if ($method -eq "GET" -or $method -eq "HEAD") {
    $store = Get-HighScoreStore
    $json = @{ scores = @($store.scores) } | ConvertTo-Json -Depth 6
    Write-TextResponse -Response $Context.Response -StatusCode 200 -Text $json -ContentType "application/json; charset=utf-8" -SkipBody $skipBody
    return
  }

  if ($method -ne "POST") {
    Write-TextResponse -Response $Context.Response -StatusCode 405 -Text '{"error":"Method Not Allowed"}' -ContentType "application/json; charset=utf-8" -SkipBody $skipBody
    return
  }

  $bytes = Read-RequestBytes -Request $Context.Request
  if ($null -eq $bytes -or $bytes.Length -eq 0) {
    Write-TextResponse -Response $Context.Response -StatusCode 400 -Text '{"error":"Missing request body."}' -ContentType "application/json; charset=utf-8" -SkipBody $skipBody
    return
  }

  try {
    $payload = [System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
  } catch {
    Write-TextResponse -Response $Context.Response -StatusCode 400 -Text '{"error":"Invalid JSON body."}' -ContentType "application/json; charset=utf-8" -SkipBody $skipBody
    return
  }

  $savedEntry = Normalize-HighScoreEntry -InputObject $payload
  $store = Get-HighScoreStore
  $sortedScores = (@($store.scores) + $savedEntry) |
    Sort-Object -Property @{ Expression = "distance"; Descending = $true }, @{ Expression = "createdAt"; Descending = $false } |
    Select-Object -First $MaxScores

  Save-HighScoreStore -Store @{ scores = @($sortedScores) }

  $json = @{
    ok = $true
    savedEntry = $savedEntry
    scores = @($sortedScores)
  } | ConvertTo-Json -Depth 6
  Write-TextResponse -Response $Context.Response -StatusCode 200 -Text $json -ContentType "application/json; charset=utf-8" -SkipBody $skipBody
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "Serving $Root at http://localhost:$Port/"
Write-Host "Press Ctrl+C to stop."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()

    try {
      $requestPath = $context.Request.Url.AbsolutePath

      if ($requestPath -eq "/api/highscores") {
        Handle-HighScoresRequest -Context $context
        continue
      }

      $relativePath = $requestPath.TrimStart("/")
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.html"
      }

      if (
        $relativePath.Contains("..") -or
        $relativePath.StartsWith("data/") -or
        $relativePath.StartsWith("data\") -or
        $relativePath -eq "server-error.log"
      ) {
        Write-TextResponse -Response $context.Response -StatusCode 400 -Text "Bad Request"
        continue
      }

      $safePath = $relativePath.Replace("/", "\")
      $filePath = Join-Path $Root $safePath

      if ((Test-Path $filePath -PathType Container)) {
        $filePath = Join-Path $filePath "index.html"
      }

      if (Test-Path $filePath -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $skipBody = $context.Request.HttpMethod.ToUpperInvariant() -eq "HEAD"
        Write-BytesResponse -Response $context.Response -StatusCode 200 -ContentType (Get-ContentType -Path $filePath) -Bytes $bytes -SkipBody $skipBody
      } else {
        Write-TextResponse -Response $context.Response -StatusCode 404 -Text "Not Found"
      }
    } catch {
      Add-Content -Path (Join-Path $Root "server-error.log") -Value $_.Exception.ToString()
      Write-TextResponse -Response $context.Response -StatusCode 500 -Text $_.Exception.Message
    } finally {
      $context.Response.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
