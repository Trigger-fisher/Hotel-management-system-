// Copied from antivirus on 2026-11-05.
// Licence: same as this repository (project-internal). Original rules; no text copied from third-party rule sets.
// Hard signs of active content in a PDF. Names are also tested after "#xx" un-escaping (the scanner feeds a
// normalised copy too), so /J#61vaScript is seen as /JavaScript. Short names are not matched alone: four random bytes
// such as "/JS(" or "/3D " inside a compressed stream would refuse a clean PDF now and then. A JavaScript action always
// names /S /JavaScript, and 3D content always names /Subtype /3D.
rule pdf_javascript : pdf active
{
    meta: description = "The PDF carries JavaScript"
    strings: $h = "%PDF-"  $a = /\/JavaScript[^A-Za-z0-9]/
    condition: $h in (0..1024) and $a
}
rule pdf_launch_action : pdf active
{
    meta: description = "The PDF starts a program (Launch action)"
    strings: $h = "%PDF-"  $a = /\/Launch[^A-Za-z0-9]/
    condition: $h in (0..1024) and $a
}
rule pdf_embedded_file : pdf active
{
    meta: description = "The PDF holds an attached file"
    strings: $h = "%PDF-"  $a = /\/EmbeddedFiles?[^A-Za-z0-9]/  $b = /\/Type\s*\/Filespec/ $c = /\/EF\s*<</
    condition: $h in (0..1024) and ($a or ($b and $c))
}
rule pdf_rich_media_or_flash : pdf active
{
    meta: description = "The PDF carries rich media, Flash or 3D"
    strings: $h = "%PDF-"  $a = /\/RichMedia[^A-Za-z0-9]/  $b = /\/(Subtype|Type)\s*\/3D[^A-Za-z0-9]/ $c = /\/Movie[^A-Za-z0-9]/
    condition: $h in (0..1024) and any of ($a, $b, $c)
}
rule pdf_auto_action_with_remote_target : pdf active
{
    meta: description = "The PDF runs an action on open that leaves the file"
    strings: $h = "%PDF-"  $o = /\/(OpenAction|AA)[^A-Za-z0-9]/  $s = /\/(SubmitForm|GoToR|GoToE|ImportData)[^A-Za-z0-9]/
    condition: $h in (0..1024) and $o and $s
}
