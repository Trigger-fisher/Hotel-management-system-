// Source: written for the HMS antivirus service (this repository), 4 Nov 2026.
// Licence: same as this repository (project-internal). Original rules; no text copied from third-party rule sets,
// because the licences of public YARA collections are mixed or unclear. Only standard file-format knowledge
// (PDF name objects, PE/ELF/ZIP/RAR/7z signatures) was used.
// Hard indicators of active content in a PDF. Names are also tested after "#xx" un-escaping (the scanner feeds
// a normalised copy too), so /J#61vaScript is seen as /JavaScript.
rule pdf_javascript : pdf active
{
    meta: description = "PDF carries JavaScript"  code = "yara_match"
    strings: $h = "%PDF-"  $a = /\/JavaScript[^A-Za-z0-9]/  $b = /\/JS[\s(<\[\/]/
    condition: $h in (0..1024) and ($a or $b)
}
rule pdf_launch_action : pdf active
{
    meta: description = "PDF has a Launch action (starts a program)"  code = "yara_match"
    strings: $h = "%PDF-"  $a = /\/Launch[^A-Za-z0-9]/
    condition: $h in (0..1024) and $a
}
rule pdf_embedded_file : pdf active
{
    meta: description = "PDF contains an embedded file or attachment"  code = "yara_match"
    strings: $h = "%PDF-"  $a = /\/EmbeddedFiles?[^A-Za-z0-9]/  $b = /\/Type\s*\/Filespec/ $c = /\/EF\s*<</
    condition: $h in (0..1024) and ($a or ($b and $c))
}
rule pdf_rich_media_or_flash : pdf active
{
    meta: description = "PDF has rich media, Flash or 3D"  code = "yara_match"
    strings: $h = "%PDF-"  $a = /\/RichMedia[^A-Za-z0-9]/  $b = /\/3D[\s\/>]/ $c = /\/Movie[^A-Za-z0-9]/
    condition: $h in (0..1024) and any of ($a, $b, $c)
}
rule pdf_auto_action_with_remote_target : pdf active
{
    meta: description = "PDF runs an action on open that leaves the file (SubmitForm, GoToR, ImportData)"  code = "yara_match"
    strings: $h = "%PDF-"  $o = /\/(OpenAction|AA)[^A-Za-z0-9]/  $s = /\/(SubmitForm|GoToR|GoToE|ImportData)[^A-Za-z0-9]/
    condition: $h in (0..1024) and $o and $s
}
