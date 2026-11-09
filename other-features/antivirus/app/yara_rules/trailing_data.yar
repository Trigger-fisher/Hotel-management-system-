// Source: written for the HMS antivirus service (this repository), 4 Nov 2026.
// Licence: same as this repository (project-internal). Original rules; no text copied from third-party rule sets,
// because the licences of public YARA collections are mixed or unclear. Only standard file-format knowledge
// (PDF name objects, PE/ELF/ZIP/RAR/7z signatures) was used.
// Scanned ONLY on the bytes that follow an image's end marker (PNG IEND, JPEG FFD9, GIF trailer, WebP RIFF
// length) or a PDF's last %%EOF. Nothing legitimate lives there, so scripts and program headers are rejected.
rule trailing_script : trailing script
{
    meta: description = "Script code after the end of the file"  code = "yara_match"
    strings:
        $php = /<\?php/ nocase
        $html = /<script[\s>]/ nocase
        $sh = /#!\/(usr\/)?bin\/(env )?(sh|bash|python[0-9.]*|perl|php)/
        $ps = /powershell(\.exe)?\s+(-[a-z]+\s+)*-(enc|encodedcommand|nop|w\s+hidden)/ nocase
        $cmd = /cmd(\.exe)?\s+\/c\s/ nocase
        $eval = /(eval|base64_decode|WScript\.Shell|ActiveXObject)\s*\(/ nocase
        $vbs = /CreateObject\s*\(\s*"WScript/ nocase
    condition: any of them
}
rule trailing_executable_or_archive : trailing executable
{
    meta: description = "Program or archive after the end of the file"  code = "yara_match"
    strings:
        $mz = "MZ"
        $dos = "This program cannot be run in DOS mode"
        $elf = { 7F 45 4C 46 }
        $zip = { 50 4B 03 04 }
        $rar = { 52 61 72 21 1A 07 }
        $z7 = { 37 7A BC AF 27 1C }
        $gz = { 1F 8B 08 }
        $macho = { CF FA ED FE }
        $java = { CA FE BA BE }
        $ole = { D0 CF 11 E0 A1 B1 1A E1 }
    condition: ($mz at 0 and $dos) or $dos or $elf at 0 or $zip at 0 or $rar at 0 or $z7 at 0 or $gz at 0
        or $macho at 0 or $java at 0 or $ole at 0
}
