# 记录真实 Windows 构建工具及 PE 依赖，阻止调试运行库或未随包交付的 GCC DLL 进入发布包。
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
            throw "发现禁止分发或未包含的运行库依赖：$dll"
        }
    }
    $records += @{ file = $binary.Name; sha256 = (Get-FileHash $binary.FullName -Algorithm SHA256).Hash.ToLower(); dependencies = $dependencies }
}
$plugin = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/Plugins/x86-unicode/additional/nsis_tauri_utils.dll'
if ((Get-FileHash $plugin -Algorithm SHA1).Hash.ToLower() -ne '75197fee3c6a814fe035788d1c34ead39349b860') {
    throw '实际 NSIS Tauri 插件与许可归档版本不一致'
}
$runtimeLibraries = @('libcmt.lib', 'libvcruntime.lib') | ForEach-Object {
    $path = Join-Path $tools "lib/x64/$_"
    @{ file = $_; source = $path; sha256 = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower() }
}
$report = @{ visualStudio = $installation.displayName; visualStudioVersion = $installation.installationVersion; msvc = $toolVersion; runtimeLibraries = $runtimeLibraries; binaries = $records; nsisPluginSha1 = '75197fee3c6a814fe035788d1c34ead39349b860' }
New-Item artifacts -ItemType Directory -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content artifacts/windows-runtime-review.json -Encoding utf8
$report | ConvertTo-Json -Depth 8
