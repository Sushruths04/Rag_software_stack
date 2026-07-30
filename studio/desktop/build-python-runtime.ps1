# Builds the embedded Python runtime the packaged desktop app ships as a
# Tauri resource (closes B-M6's "no bundled Python runtime" gap).
#
# Layout produced at studio/desktop/src-tauri/python-runtime/:
#   python.exe + python313.dll + stdlib   (python.org embeddable distribution)
#   python313._pth                        (edited: stdlib + site-packages + app)
#   Lib/site-packages/                    (pip install --target of the backend's
#                                          LIGHT dependencies: fastapi/uvicorn/
#                                          pydantic/python-dotenv)
#   app/studio/backend + app/studio/__init__.py  (backend source, no tests)
#
# Scope (deliberate): the runtime serves the FULL stub backend — /health,
# /api/blocks, validate, save/load, stub runs — on a machine with nothing
# installed. The ML engine stack (torch/spacy/sentence-transformers, ~1.6 GB)
# is NOT bundled; build_registry(use_stubs=False) degrades to stubs with a
# logged warning (see test_registry_degradation.py), and power users point
# RAGGT_ENGINE_PYTHON at a full venv to get live blocks. Bundling the full
# engine is a size/first-run-model-download problem, not a mechanism problem:
# rerun this script with -IncludeEngine once that is wanted.
#
# Usage:  powershell -File studio/desktop/build-python-runtime.ps1 [-IncludeEngine]

param(
  [switch]$IncludeEngine
)

$ErrorActionPreference = "Stop"

$PythonVersion = "3.13.3"   # keep in lockstep with the dev venv's minor version
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$RuntimeDir = Join-Path $ScriptDir "src-tauri\python-runtime"
$ZipUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$ZipPath = Join-Path $env:TEMP "python-$PythonVersion-embed-amd64.zip"

Write-Host "== GRAFT Studio embedded-runtime build =="
Write-Host "repo root : $RepoRoot"
Write-Host "runtime   : $RuntimeDir"

# 1. fresh runtime dir
if (Test-Path $RuntimeDir) { Remove-Item -Recurse -Force $RuntimeDir }
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

# 2. embeddable distribution
if (-not (Test-Path $ZipPath)) {
  Write-Host "downloading $ZipUrl"
  Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath
}
Expand-Archive -Path $ZipPath -DestinationPath $RuntimeDir -Force

# 3. sys.path control: the ._pth file makes the runtime fully hermetic
#    (PYTHONPATH and the registry are ignored when a ._pth is present).
$PthFile = Get-ChildItem $RuntimeDir -Filter "python*._pth" | Select-Object -First 1
@(
  ($PthFile.BaseName -replace "._pth$", "") + ".zip"
  "."
  "Lib\site-packages"
  "app"
) | Set-Content $PthFile.FullName -Encoding ascii

# 4. light backend dependencies into Lib/site-packages (same-platform,
#    same-minor-version interpreter, so binary wheels are compatible)
$VenvPython = Join-Path $RepoRoot "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) { $VenvPython = Join-Path (Split-Path $RepoRoot -Parent) "..\venv\Scripts\python.exe" }
$SitePackages = Join-Path $RuntimeDir "Lib\site-packages"
New-Item -ItemType Directory -Force $SitePackages | Out-Null
$deps = @("fastapi", "uvicorn", "python-dotenv")
if ($IncludeEngine) { $deps += @(Get-Content (Join-Path $RepoRoot "requirements.txt")) }
& $VenvPython -m pip install --target $SitePackages --quiet @deps
if ($LASTEXITCODE -ne 0) { throw "pip install --target failed" }

# 5. backend source (no tests, no data, no caches)
$AppDir = Join-Path $RuntimeDir "app"
New-Item -ItemType Directory -Force (Join-Path $AppDir "studio") | Out-Null
Copy-Item (Join-Path $RepoRoot "studio\__init__.py") (Join-Path $AppDir "studio\") -ErrorAction SilentlyContinue
Copy-Item (Join-Path $RepoRoot "studio\backend") (Join-Path $AppDir "studio\backend") -Recurse -Force
Remove-Item (Join-Path $AppDir "studio\backend\tests") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $AppDir "studio\backend\data") -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $AppDir -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
if ($IncludeEngine) {
  Copy-Item (Join-Path $RepoRoot "src\rag_gt") (Join-Path $AppDir "rag_gt") -Recurse -Force
  Get-ChildItem $AppDir -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
}

# 6. smoke-verify the runtime hermetically (neutral cwd, no repo on path)
$RuntimePython = Join-Path $RuntimeDir "python.exe"
Push-Location $env:TEMP
try {
  $imports = & $RuntimePython -c "import studio.backend.api; print('backend imports ok')"
  Write-Host $imports
  if ($LASTEXITCODE -ne 0) { throw "runtime smoke import failed" }
} finally {
  Pop-Location
}

$size = "{0:N0} MB" -f ((Get-ChildItem $RuntimeDir -Recurse | Measure-Object Length -Sum).Sum / 1MB)
Write-Host "== runtime built: $size at $RuntimeDir =="
