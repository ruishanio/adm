# 检查实际 PE 依赖，避免发布包依赖调试运行库或未包含的 GCC DLL。
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json)[0]
if (-not $installation) { throw '无法核对 Windows Runner 的 Visual Studio 来源' }
$toolVersion = (Get-Content (Join-Path $installation.installationPath 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt')).Trim()
$tools = Join-Path $installation.installationPath "VC/Tools/MSVC/$toolVersion"
$dumpbin = Join-Path $tools 'bin/Hostx64/x64/dumpbin.exe'
$records = @()
foreach ($binary in @(Get-Item 'release/win-unpacked/adm.exe') + @(Get-ChildItem 'release/win-unpacked/platform-tools' -File | Where-Object { $_.Extension -in '.exe', '.dll' })) {
    $output = & $dumpbin /NOLOGO /DEPENDENTS $binary.FullName
    if ($LASTEXITCODE -ne 0) { throw "无法检查 PE 依赖：$($binary.Name)" }
    $dependencies = @($output | Where-Object { $_ -match '^\s+[^\s]+\.dll\s*$' } | ForEach-Object { $_.Trim() })
    if ($dependencies.Count -eq 0) { throw "PE 依赖结果为空：$($binary.Name)" }
    foreach ($dll in $dependencies) {
        if ($dll -match '(?i)^(vcruntime\d+d|msvcp\d+d|ucrtbased|libgcc.*|libstdc\+\+.*|libwinpthread.*)\.dll$') {
            throw "发现调试或未包含的运行库依赖：$dll"
        }
    }
    $records += @{ file = $binary.Name; sha256 = (Get-FileHash $binary.FullName -Algorithm SHA256).Hash.ToLower(); dependencies = $dependencies }
}
$report = @{ visualStudioVersion = $installation.installationVersion; msvc = $toolVersion; binaries = $records }
New-Item artifacts -ItemType Directory -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content artifacts/windows-runtime-check.json -Encoding utf8
$report | ConvertTo-Json -Depth 8
