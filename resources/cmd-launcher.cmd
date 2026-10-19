@echo off
setlocal DisableDelayedExpansion

rem Resolve only supported Codex launchers, in the usual CMD search order.
set "CAA_CODEX="
"%SystemRoot%\System32\where.exe" /q codex
if errorlevel 1 goto missing
for /f "delims=" %%F in ('""%SystemRoot%\System32\where.exe" codex"') do (
    if not defined CAA_CODEX if /i "%%~xF"==".exe" set "CAA_CODEX=%%F"
    if not defined CAA_CODEX if /i "%%~xF"==".cmd" set "CAA_CODEX=%%F"
)
if not defined CAA_CODEX goto missing

rem FORFILES expands hexadecimal bytes without embedding control bytes here.
rem Use this existing resource as its match, and preserve the caller's cwd.
pushd "%~dp0"
if errorlevel 1 exit /b 1
set "CAA_CONTROLS="
for /f "delims=" %%F in ('""%SystemRoot%\System32\forfiles.exe" /m cmd-launcher.cmd /c "cmd.exe /d /c echo 0x1b0x07""') do set "CAA_CONTROLS=%%F"
popd
if not defined CAA_CONTROLS (
    >&2 echo Codex Auto-Accept: could not initialize terminal shell integration.
    exit /b 1
)
set "CAA_ESCAPE=%CAA_CONTROLS:~0,1%"
set "CAA_BELL=%CAA_CONTROLS:~1,1%"
<nul set /p "=%CAA_ESCAPE%]633;P;IsWindows=True%CAA_BELL%%CAA_ESCAPE%]633;A%CAA_BELL%%CAA_ESCAPE%]633;B%CAA_BELL%%CAA_ESCAPE%]633;E;codex%CAA_BELL%%CAA_ESCAPE%]633;C%CAA_BELL%"

rem A .cmd intentionally replaces this batch; the outer cmd /c then exits.
rem Do not CALL it: CALL reparses percent signs and other path characters.
"%CAA_CODEX%"

rem Native .exe launchers return here. Terminal close also ends monitoring.
set "CAA_EXIT_CODE=%ERRORLEVEL%"
<nul set /p "=%CAA_ESCAPE%]633;D;%CAA_EXIT_CODE%%CAA_BELL%"
exit /b %CAA_EXIT_CODE%

:missing
>&2 echo Codex Auto-Accept: codex.exe or codex.cmd was not found on PATH.
exit /b 9009
