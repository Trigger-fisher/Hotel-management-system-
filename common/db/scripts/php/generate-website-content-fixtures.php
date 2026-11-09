<?php
// Golden fixtures for the Website's content rules, made by REAL PHP running VERBATIM copies of Pallav's Support/Site/Sanitizer.php (richText with its
// urlIsSafe and cleanNode, the allow-list and the strip-entirely list), the offline parts of Support/Site/MapTools.php (coordinates from a full link,
// straightLineKm, kmLabel, placeIcon) and the line splitting of ContentController (enquire_points), PolicyController (policy_lines) with Laravel's
// collect()->filter() (which drops every falsy line, "0" included).
//
// Usage:  php db/scripts/php/generate-website-content-fixtures.php > db/scripts/php/fixtures/website-content.json
declare(strict_types=1);

class Sanitizer
{
    private const TAGS = [
        'p' => [], 'br' => [], 'strong' => [], 'b' => [], 'em' => [], 'i' => [],
        'u' => [], 's' => [], 'blockquote' => [],
        'ul' => [], 'ol' => [], 'li' => ['class', 'data-list'],
        'a' => ['href', 'target', 'rel'],
        'span' => ['class'],
    ];

    private const STRIP_ENTIRELY = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'noscript', 'template', 'link', 'meta', 'base'];

    private const URL_SCHEMES = ['http', 'https', 'mailto', 'tel'];

    public static function richText(?string $html): string
    {
        $html = trim((string) $html);
        if ($html === '') {
            return '';
        }

        $encoded = mb_encode_numericentity($html, [0x80, 0x10FFFF, 0, 0x10FFFF], 'UTF-8');

        $doc = new DOMDocument();
        $previous = libxml_use_internal_errors(true);
        $loaded = $doc->loadHTML('<div>'.$encoded.'</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        if (! $loaded || ! ($root = $doc->documentElement)) {
            return '';
        }

        self::cleanNode($root);

        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $doc->saveHTML($child);
        }

        return trim(mb_decode_numericentity($out, [0x80, 0x10FFFF, 0, 0x10FFFF], 'UTF-8'));
    }

    private static function urlIsSafe(string $url): bool
    {
        $clean = html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $clean = preg_replace('/[\x00-\x20\x7F]/', '', $clean) ?? '';

        if ($clean === '') {
            return false;
        }

        if (! preg_match('~^([a-z][a-z0-9+.\-]*):~i', $clean, $m)) {
            return true;
        }

        return in_array(strtolower($m[1]), self::URL_SCHEMES, true);
    }

    private static function cleanNode(DOMNode $node): void
    {
        foreach (iterator_to_array($node->childNodes) as $child) {
            if ($child instanceof DOMText) {
                continue;
            }

            if ($child instanceof DOMComment || $child instanceof DOMProcessingInstruction || ! $child instanceof DOMElement) {
                $child->parentNode->removeChild($child);

                continue;
            }

            $tag = strtolower($child->nodeName);

            if (in_array($tag, self::STRIP_ENTIRELY, true)) {
                $child->parentNode->removeChild($child);

                continue;
            }

            if (! array_key_exists($tag, self::TAGS)) {
                self::cleanNode($child);
                while ($child->firstChild) {
                    $child->parentNode->insertBefore($child->firstChild, $child);
                }
                $child->parentNode->removeChild($child);

                continue;
            }

            foreach (iterator_to_array($child->attributes) as $attr) {
                $name = strtolower($attr->nodeName);

                if (! in_array($name, self::TAGS[$tag], true)) {
                    $child->removeAttribute($attr->nodeName);

                    continue;
                }

                if ($name === 'href' && ! self::urlIsSafe($attr->nodeValue ?? '')) {
                    $child->removeAttribute($attr->nodeName);
                }
            }

            if ($tag === 'a' && $child->hasAttribute('href') && $child->getAttribute('target') === '_blank') {
                $child->setAttribute('rel', 'noopener noreferrer');
            }

            self::cleanNode($child);
        }
    }
}

function coordinatesOf(string $finalUrl): ?array
{
    foreach (['/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/', '/@(-?\d+\.\d+),(-?\d+\.\d+)/', '/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/'] as $pattern) {
        if (preg_match($pattern, $finalUrl, $m)) {
            return ['lat' => (float) $m[1], 'lng' => (float) $m[2]];
        }
    }

    return null;
}

function straightLineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
{
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

    return 6371.0 * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

function kmLabel(float $km): string
{
    return ($km < 10 ? number_format($km, 1) : number_format($km, 0)).' km';
}

function placeIcon(string $title): string
{
    $t = mb_strtolower($title);
    $library = [
        [['airport'], 'airport'],
        [['railway', 'rail station', 'train station'], 'rail'],
        [['bus stand', 'bus station', 'bus depot', 'bus stop'], 'bus'],
        [['hospital', 'clinic', 'medical'], 'hospital'],
        [['mall', 'market', 'shopping'], 'shopping'],
        [['temple', 'mandir', 'church', 'mosque'], 'worship'],
        [['school', 'college', 'university', 'institute'], 'school'],
        [['park', 'garden'], 'park'],
        [['stadium', 'ground', 'race course'], 'stadium'],
    ];
    foreach ($library as [$keywords, $name]) {
        foreach ($keywords as $keyword) {
            if (str_contains($t, $keyword)) {
                return $name;
            }
        }
    }

    return 'pin';
}

/** ContentController: preg_split('/\R/') then map('trim') then filter() (falsy dropped: "0" too) then values. */
function pointLines(string $text): array
{
    return array_values(array_filter(array_map('trim', preg_split('/\R/', $text)), fn ($x) => (bool) $x));
}

/** PolicyController: trim of the UTF-8 re-encoded line cut to 255 chars, filter(), take(50). */
function policyLines(string $text): array
{
    return array_slice(array_values(array_filter(array_map(fn ($line) => mb_substr(trim(mb_convert_encoding($line, 'UTF-8', 'UTF-8')), 0, 255), preg_split('/\R/', $text)), fn ($x) => (bool) $x)), 0, 50);
}

$rich = [
    '', '   ', 'plain text', '<p>Hello <strong>world</strong></p>', '<p>One</p><p>Two</p>', '<p><br></p>', '<p></p>', 'a < b & c > d', 'Tom &amp; Jerry', '&nbsp;&copy;&euro;', '₹ 1,200 – कमरा / રૂમ',
    '<ul><li>First</li><li class="ql-indent-1" data-list="bullet" style="color:red">Second</li></ul>', '<ol><li>One</li></ol>',
    '<p>Visit <a href="https://example.com/a?b=1&c=2" target="_blank" onclick="x()">our site</a></p>', '<a href="javascript:alert(1)">bad</a>', '<a href="JaVaScRiPt:alert(1)">bad</a>',
    '<a href="java&#09;script:alert(1)">bad</a>', '<a href="  javascript:alert(1)">bad</a>', '<a href="data:text/html;base64,PHNjcmlwdD4=">bad</a>', '<a href="/relative/page">rel</a>',
    '<a href="mailto:hotel@example.com">mail</a>', '<a href="tel:+912812456789">call</a>', '<a href="ftp://x.example/y">ftp</a>', '<a href="">empty</a>', '<a href="#top">hash</a>', '<a target="_blank">no href</a>',
    '<a href="http://x.example" target="_blank" rel="opener">blank</a>', '<a href="http://x.example" target="_self">self</a>',
    '<script>alert(1)</script>after', '<p>x<script>alert(1)</script>y</p>', '<style>p{color:red}</style><p>styled</p>', '<iframe src="http://evil"></iframe>text', '<object data="x">o</object>', '<embed src="x">',
    '<form action="x"><input name="a"><button>go</button></form>kept', '<textarea>t</textarea><select><option>o</option></select>', '<svg><script>alert(1)</script><circle/></svg>done', '<math><mi>x</mi></math>m',
    '<noscript>n</noscript>ns', '<template><b>t</b></template>tp', '<link rel="stylesheet" href="x"><meta charset="x"><base href="x">', '<!-- comment --><p>c</p>', '<?php echo 1; ?>after',
    '<div>block <span class="a b" style="x:y" id="z">span</span></div>', '<h1>Head</h1><h2>Sub</h2>', '<font color="red"><center>old</center></font>', '<img src="x" onerror="alert(1)">img', '<p onclick="x()" style="y">p</p>',
    '<p>Line<br>break<br/>again</p>', '<b>b</b><i>i</i><u>u</u><s>s</s><em>e</em><blockquote>q</blockquote>', '<p>unclosed <b>bold', '</p>stray close', '<p>nested <p>paragraphs</p></p>',
    '<ul><li>a<ul><li>b</li></ul></li></ul>', '<table><tr><td>cell</td></tr></table>', '<p>"quotes" and \'apos\'</p>', '<a href="http://x.example/?a=\'b\'&q=\"c\"">q</a>', '<a href="http://x.example/é">accent</a>',
    '<p>emoji 😀 text</p>', 'text<br>more', '<span>only span</span>', '<SCRIPT>alert(1)</SCRIPT><P>UPPER</P>', '<p>a</p>'."\n".'<p>b</p>', "<p>tab\there</p>", '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    '<a href="http://x.example" title="t" class="c">attrs</a>', '<li>stray li</li>', '<p>0</p>', '0',
];
$richOut = [];
foreach ($rich as $in) {
    $out = Sanitizer::richText($in);
    // validUtf8 flags output that is not valid UTF-8 (none expected today); an emoji comes out corrupted but valid, so the port's test skips astral input.
    $richOut[] = ['in' => $in, 'out' => $out, 'again' => Sanitizer::richText($out), 'blank' => trim(strip_tags($out)) === '', 'validUtf8' => mb_check_encoding($out, 'UTF-8')];
}

$urls = [
    'https://www.google.com/maps/place/Rajkot+Airport/@22.3092,70.7795,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d22.3093456!4d70.7794321',
    'https://www.google.com/maps/@22.3039,70.8022,15z', 'https://maps.google.com/?q=22.30,70.80', 'https://www.google.com/maps?foo=1&q=-33.8688,151.2093', 'https://maps.app.goo.gl/abc123',
    'https://www.google.com/maps/search/hotel', 'https://www.google.com/maps/@22,70,15z', 'https://x.example/@12.5,77.6', 'https://x.example/?q=1.5,2.5&z=10', 'https://x.example/!3d1.5!4d2.5/@9.9,8.8',
];
$coords = [];
foreach ($urls as $u) {
    $coords[] = ['url' => $u, 'result' => coordinatesOf($u)];
}
$points = [[22.3092, 70.7795, 22.3039, 70.8022], [22.3039, 70.8022, 23.0225, 72.5714], [0.0, 0.0, 0.0, 0.0], [51.5074, -0.1278, 48.8566, 2.3522], [-33.8688, 151.2093, 22.3039, 70.8022], [22.30, 70.80, 22.31, 70.81], [10.0, 10.0, 10.0, 10.05], [28.6139, 77.2090, 19.0760, 72.8777]];
$distances = [];
foreach ($points as [$a, $b, $c, $d]) {
    $km = straightLineKm($a, $b, $c, $d);
    $distances[] = ['from' => [$a, $b], 'to' => [$c, $d], 'km' => $km, 'label' => kmLabel($km)];
}
$labels = [];
foreach ([0.0, 0.04, 0.05, 0.95, 1.0, 3.25, 3.35, 9.94, 9.95, 9.99, 10.0, 10.4, 10.5, 11.5, 12.5, 99.5, 1234.56, 0.449999] as $km) {
    $labels[] = ['km' => $km, 'label' => kmLabel($km)];
}
$icons = [];
foreach (['Rajkot Airport', 'Railway Station', 'Rail Station Road', 'Central Bus Stand', 'Civil Hospital', 'City Mall', 'Jain Temple', 'Swaminarayan MANDIR', 'St. Mary Church', 'Jama Mosque', 'Presidency School', 'Atmiya University', 'Race Course Ground', 'Racecourse', 'Cricket Stadium', 'Botanical Garden', 'Gandhi Park', 'Hotel Pallav', 'ATM', 'AIRPORT road', 'Medical College', 'Shopping Complex'] as $t) {
    $icons[] = ['title' => $t, 'icon' => placeIcon($t)];
}
$lines = [];
foreach (["a\nb", " a \r\n\r\n b \r\n", "0\n1\n 0 \n00", "x\ry\rz", "line1\n\n\nline2", '', "   \n  ", "é\nક\n" . str_repeat('x', 300), implode("\n", range(1, 60)), "tab\there\n\tindented"] as $t) {
    $lines[] = ['in' => $t, 'points' => pointLines($t), 'policy' => policyLines($t)];
}

echo json_encode(['php' => PHP_VERSION, 'rich' => $richOut, 'coordinates' => $coords, 'distances' => $distances, 'kmLabels' => $labels, 'icons' => $icons, 'lines' => $lines], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), "\n";
