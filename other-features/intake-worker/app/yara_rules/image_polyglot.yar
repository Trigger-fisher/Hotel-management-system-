// Copied from antivirus on 2026-11-05 and extended for the intake worker (HEIC, PDF, HTML and script inside a picture).
// Licence: same as this repository (project-internal). Original rules; no text copied from third-party rule sets.
// Scanned on the whole file. A picture that is also something else. Only multi-byte, low-false-positive strings are
// used, because compressed pixel data can contain any 4 bytes; the picture test reads the header, not strings.
private rule is_image
{
    condition:
        uint32be(0) == 0x89504E47 or (uint16be(0) == 0xFFD8 and uint8(2) == 0xFF) or uint32be(0) == 0x47494638
        or (uint32be(0) == 0x52494646 and uint32be(8) == 0x57454250) or uint32be(4) == 0x66747970
}
rule polyglot_windows_executable : polyglot
{
    meta: description = "The picture also holds a Windows program"
    strings: $dos = "This program cannot be run in DOS mode"  $pe = "PE\x00\x00L" $pe2 = "PE\x00\x00d\x86"
    condition: is_image and $dos and ($pe or $pe2)
}
rule polyglot_elf_executable : polyglot
{
    meta: description = "The picture also holds a Linux program"
    strings: $e1 = { 7F 45 4C 46 02 01 01 }  $e2 = { 7F 45 4C 46 01 01 01 }
    condition: is_image and ($e1 or $e2)
}
rule polyglot_zip_archive : polyglot
{
    meta: description = "The picture also holds a ZIP archive"
    strings: $l = { 50 4B 03 04 }  $c = { 50 4B 01 02 }  $e = { 50 4B 05 06 }
    condition: is_image and $l and $c and $e
}
rule polyglot_rar_or_7z_archive : polyglot
{
    meta: description = "The picture also holds a RAR or 7-Zip archive"
    strings: $r = { 52 61 72 21 1A 07 }  $z = { 37 7A BC AF 27 1C }
    condition: is_image and ($r or $z)
}
rule polyglot_java_or_script_header : polyglot
{
    meta: description = "The picture is also a Java class or a script"
    strings: $j = { CA FE BA BE 00 00 00 }  $sh = /#!\/(usr\/)?bin\/(env )?(sh|bash|python[0-9.]*|perl|php)/
    condition: is_image and ($j or $sh)
}
rule polyglot_pdf_document : polyglot
{
    meta: description = "The picture is also a PDF document"
    strings: $h = "%PDF-"  $o = /\d{1,7} \d{1,5} obj/  $e = "endobj"  $t = "trailer"  $x = "startxref"
    condition: is_image and $h and $o and $e and ($t or $x)
}
rule polyglot_html_document : polyglot
{
    meta: description = "The picture is also a web page"
    strings: $h = /<html[\s>]/ nocase  $b = /<(body|head|iframe)[\s>]/ nocase
    condition: is_image and $h and $b
}
rule image_embedded_script : script
{
    meta: description = "The picture carries script code"
    strings:
        $php = "<?php" nocase
        $script = /<script[\s>]/ nocase
        $phpexec = /(eval|assert|system|passthru|shell_exec|exec)\s*\(\s*(base64_decode|gzinflate|gzuncompress|str_rot13|\$_(GET|POST|REQUEST|COOKIE))/ nocase
        $jsp = /<%@\s*page/ nocase
        $asp = /<%\s*(eval|execute)[\s(]/ nocase
        $wsh = /CreateObject\s*\(\s*"WScript/ nocase
        $ps = /powershell(\.exe)?\s+(-[a-z]+\s+)*-(enc|encodedcommand|nop|w\s+hidden)/ nocase
        $hta = "<hta:application" nocase
    condition: is_image and any of them
}
