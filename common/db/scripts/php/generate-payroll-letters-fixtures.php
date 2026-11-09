<?php
// Golden fixtures for the experience letter's {DURATION} (EmployeeSeparation::tenureLabel :60-72): Carbon's
// $from->diffForHumans($to, [syntax => ABSOLUTE, parts => 2]) over date-only values. Carbon itself is not installed here, so the
// interval comes from REAL PHP's DateTime::diff (which Carbon's diff is built on) and the wording is Carbon's own rule, written out:
// units in order year, month, week (floor(days / 7)), day (days % 7), the first two non-zero ones joined by a space, "0 seconds" when all are
// zero; singular for 1 ("1 year 3 months", "2 weeks 3 days"). Also the letters' placeholders (JoiningLetter / ExperienceLetter ::renderFor).
//
// Usage:  php db/scripts/php/generate-payroll-letters-fixtures.php > db/scripts/php/fixtures/payroll-letters.json
declare(strict_types=1);

date_default_timezone_set('Asia/Kolkata');
mt_srand(20261008);

function tenure(string $from, string $to): array
{
    $a = new DateTimeImmutable($from.' 00:00:00');
    $b = new DateTimeImmutable($to.' 00:00:00');
    $i = $a->diff($b);
    $units = [['year', $i->y], ['month', $i->m], ['week', intdiv($i->d, 7)], ['day', $i->d % 7]];
    $parts = [];
    foreach ($units as [$unit, $value]) {
        if ($value > 0 && count($parts) < 2) {
            $parts[] = $value.' '.$unit.($value === 1 ? '' : 's');
        }
    }

    return ['y' => $i->y, 'm' => $i->m, 'd' => $i->d, 'invert' => $i->invert, 'label' => $parts ? implode(' ', $parts) : '0 seconds'];
}

$pairs = [['2024-01-31', '2024-03-01'], ['2025-01-10', '2026-01-10'], ['2025-11-05', '2026-10-27'], ['2026-09-08', '2026-09-08'], ['2026-09-08', '2026-09-09'],
    ['2023-02-28', '2024-02-29'], ['2024-02-29', '2025-02-28'], ['2024-03-31', '2024-04-30'], ['2020-05-31', '2020-06-30'], ['2019-12-31', '2020-01-31'],
    ['2026-01-01', '2026-12-31'], ['2026-03-31', '2026-04-01'], ['2026-10-27', '2025-11-05'], ['2022-08-15', '2026-08-14']];
for ($n = 0; $n < 260; $n++) {
    $a = mktime(0, 0, 0, mt_rand(1, 12), mt_rand(1, 28) + (mt_rand(0, 3) === 0 ? mt_rand(0, 3) : 0), mt_rand(2018, 2026));
    $b = $a + mt_rand(-40, 1500) * 86400;
    $pairs[] = [date('Y-m-d', $a), date('Y-m-d', $b)];
}
$tenures = array_map(fn ($p) => ['from' => $p[0], 'to' => $p[1]] + tenure($p[0], $p[1]), $pairs);

// placeholders: strtr over the exact set, dates 'd-m-Y' (joining) / 'd M Y' (experience)
$joining = ['name' => 'Asha Patel', 'designation' => 'Chef', 'department' => null, 'responsibilities' => 'Run the kitchen. {DESIGNATION} duties', 'joining' => '2026-09-08', 'today' => '2026-10-05'];
$text = 'Dear {EMPLOYEE_NAME}, as {DESIGNATION} ({DEPARTMENT}) from {JOINING_DATE}; {RESPONSIBILITIES}; today {CURRENT_DATE}; {UNKNOWN} {employee_name}';
$render = strtr($text, [
    '{EMPLOYEE_NAME}' => $joining['name'],
    '{DESIGNATION}' => (string) $joining['designation'],
    '{DEPARTMENT}' => (string) $joining['department'],
    '{RESPONSIBILITIES}' => (string) $joining['responsibilities'],
    '{JOINING_DATE}' => (new DateTimeImmutable($joining['joining']))->format('d-m-Y'),
    '{CURRENT_DATE}' => (new DateTimeImmutable($joining['today']))->format('d-m-Y'),
]);
$expText = '{EMPLOYEE_NAME} {JOINING_DATE} {LAST_WORKING_DATE} {DURATION} {CURRENT_DATE} {DESIGNATION}';
$expRender = strtr($expText, [
    '{EMPLOYEE_NAME}' => 'Asha Patel',
    '{DESIGNATION}' => 'Chef',
    '{DEPARTMENT}' => '',
    '{JOINING_DATE}' => (new DateTimeImmutable('2025-01-10'))->format('d M Y'),
    '{LAST_WORKING_DATE}' => (new DateTimeImmutable('2026-10-27'))->format('d M Y'),
    '{DURATION}' => tenure('2025-01-10', '2026-10-27')['label'],
    '{CURRENT_DATE}' => (new DateTimeImmutable('2026-10-05'))->format('d M Y'),
]);

echo json_encode(['php' => PHP_VERSION, 'tenures' => $tenures, 'joining' => ['text' => $text, 'out' => $render], 'experience' => ['text' => $expText, 'out' => $expRender]],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
