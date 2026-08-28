@echo off
rem Abre el TPV en una ventana de Chrome separada y maximizada. Los tickets se
rem imprimen mediante QZ Tray; este script no selecciona impresora.
rem
rem Uso:
rem   pos-kiosk.cmd                        (usa http://localhost)
rem   pos-kiosk.cmd https://tienda.local
rem
rem Para que arranque solo al encender: crea un acceso directo a este
rem fichero y ponlo en la carpeta Inicio (tecla Windows + R, shell:startup).

setlocal

set "URL=%~1"
if "%URL%"=="" set "URL=http://localhost"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME%" (
    echo No se ha encontrado Google Chrome en este equipo.
    echo Instalalo y vuelve a ejecutar este fichero.
    pause
    exit /b 1
)

rem Perfil aparte: asi la ventana del TPV no se mezcla con el Chrome que se
rem use para cualquier otra cosa.
set "PROFILE=%LocalAppData%\OpenERP\pos-kiosk"

start "" "%CHROME%" --user-data-dir="%PROFILE%" --start-maximized --app="%URL%/pos"

endlocal
