@echo off
rem Abre el TPV en Chrome de forma que el ticket salga directo por la
rem impresora predeterminada, sin el cuadro de impresion.
rem
rem Por que hace falta: una pagina web NO puede saltarse ese cuadro. Es una
rem restriccion de seguridad del navegador, no algo que se pueda programar
rem desde la aplicacion. La forma soportada de quitarlo es arrancar el
rem propio Chrome en modo caja, con --kiosk-printing.
rem
rem Uso:
rem   pos-kiosk.cmd                        (usa http://localhost)
rem   pos-kiosk.cmd https://tienda.local
rem
rem Antes, una sola vez en el equipo de la caja:
rem   1. Poner la impresora de tickets como PREDETERMINADA de Windows. Es la
rem      que usara: el modo caja no pregunta, y por eso no elige.
rem   2. En sus propiedades, dejar puesto el ancho del rollo (58 u 80 mm).
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

rem Perfil aparte: asi el modo caja y sus ajustes de impresion no se mezclan
rem con el Chrome que se use para cualquier otra cosa.
set "PROFILE=%LocalAppData%\OpenERP\pos-kiosk"

start "" "%CHROME%" --kiosk-printing --user-data-dir="%PROFILE%" --start-maximized --app="%URL%/pos"

endlocal
