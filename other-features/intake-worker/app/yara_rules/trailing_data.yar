// Copied from antivirus on 2026-11-05 and extended (web page, JSP/ASP, HTA).
// Licence: same as this repository (project-internal). Original rules; no text copied from third-party rule sets.
// Scanned ONLY on the bytes after the real end of the picture (JPEG and PNG walked marker by marker, WebP RIFF length,
// HEIC last box) or after a PDF's last %%EOF. Phones may append a video or maker data there (motion photos), so only
// strings of five bytes or more, or a header at the very start of the tail, count.
rule trailing_script : trailing script
{
    meta: description = "Script code is hidden after the end of the file"
    strings:
        $php = "<?php" nocase
        $phpshort = /<\?=\s*\$[A-Za-z_]/
        $html = /<(script|html|iframe)[\s>]/ nocase
        $sh = /#!\/(usr\/)?bin\/(env )?(sh|bash|python[0-9.]*|perl|php)/
        $ps = /powershell(\.exe)?\s+(-[a-z]+\s+)*-(enc|encodedcommand|nop|w\s+hidden)/ nocase
        $cmd = /cmd(\.exe)?\s+\/c\s/ nocase
        $eval = /(eval|base64_decode|WScript\.Shell|ActiveXObject)\s*\(/ nocase
        $vbs = /CreateObject\s*\(\s*"WScript/ nocase
        $jsp = /<%(@\s*page|=\s*[A-Za-z_]|\s*(eval|execute|Response|out\.))/ nocase
        $hta = "<hta:application" nocase
    condition: any of them
}
rule trailing_executable_or_archive : trailing executable
{
    meta: description = "A program or an archive is hidden after the end of the file"
    strings:
        $mz = "MZ"
        $pe = { 50 45 00 00 }
        $dos = "This program cannot be run in DOS mode"
        $elf = { 7F 45 4C 46 }
        $zip = { 50 4B 03 04 }
        $zipend = { 50 4B 05 06 }
        $rar = { 52 61 72 21 1A 07 }
        $z7 = { 37 7A BC AF 27 1C }
        $gz = { 1F 8B 08 }
        $macho = { CF FA ED FE }
        $java = { CA FE BA BE }
        $ole = { D0 CF 11 E0 A1 B1 1A E1 }
    condition: ($mz at 0 and $pe) or $dos or $elf at 0 or $zip at 0 or ($zip and $zipend) or $rar or $z7
        or $gz at 0 or $macho at 0 or $java at 0 or $ole at 0
}
