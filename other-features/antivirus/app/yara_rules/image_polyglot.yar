// Source: written for the HMS antivirus service (this repository), 4 Nov 2026.
// Licence: same as this repository (project-internal). Original rules; no text copied from third-party rule sets,
// because the licences of public YARA collections are mixed or unclear. Only standard file-format knowledge
// (PDF name objects, PE/ELF/ZIP/RAR/7z signatures) was used.
// An image that is also something else. Only multi-byte, low-false-positive signatures are used, because
// compressed pixel data can contain any 4 bytes.
private rule is_image
{
    strings: $png = { 89 50 4E 47 0D 0A 1A 0A }  $jpg = { FF D8 FF }  $gif = "GIF8"  $bmp = "BM"  $riff = "RIFF"
    condition: $png at 0 or $jpg at 0 or $gif at 0 or $riff at 0 or ($bmp at 0)
}
rule polyglot_windows_executable : polyglot
{
    meta: description = "Image file that also contains a Windows executable"  code = "yara_match"
    strings: $dos = "This program cannot be run in DOS mode"  $pe = "PE\x00\x00L" $pe2 = "PE\x00\x00d\x86"
    condition: is_image and $dos and ($pe or $pe2)
}
rule polyglot_elf_executable : polyglot
{
    meta: description = "Image file that also contains a Linux executable"  code = "yara_match"
    strings: $e1 = { 7F 45 4C 46 02 01 01 }  $e2 = { 7F 45 4C 46 01 01 01 }
    condition: is_image and ($e1 or $e2) and not ($e1 at 0) and not ($e2 at 0)
}
rule polyglot_zip_archive : polyglot
{
    meta: description = "Image file with a ZIP archive inside (local header, central directory and end record all present)"  code = "yara_match"
    strings: $l = { 50 4B 03 04 }  $c = { 50 4B 01 02 }  $e = { 50 4B 05 06 }
    condition: is_image and $l and $c and $e
}
rule polyglot_rar_or_7z_archive : polyglot
{
    meta: description = "Image file with a RAR or 7-Zip archive inside"  code = "yara_match"
    strings: $r = { 52 61 72 21 1A 07 }  $z = { 37 7A BC AF 27 1C }
    condition: is_image and ($r or $z)
}
rule polyglot_java_or_script_header : polyglot
{
    meta: description = "Image file that is also a Java class or a script with a shebang"  code = "yara_match"
    strings: $j = { CA FE BA BE 00 00 00 }  $sh = /#!\/(usr\/)?bin\/(env )?(sh|bash|python[0-9.]*|perl|php)/
    condition: is_image and ($j or $sh)
}
