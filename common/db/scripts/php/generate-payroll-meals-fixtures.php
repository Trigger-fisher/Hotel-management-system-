<?php
// Golden fixtures for the staff-meals bill, made by REAL PHP running VERBATIM copies of Pallav's Support/FoodCharges.php: rateOn (:27-34),
// countedDays (:131-176), the per-person rows of statement (:213-238), pricesIn (:263-277) and note (:279-307), with EmployeeMealPeriod::covers
// (:46-50). Collections are plain arrays; Carbon is DateTimeImmutable at the start of the day ('j M' and 'j' formats are the same).
//
// Usage:  php db/scripts/php/generate-payroll-meals-fixtures.php > db/scripts/php/fixtures/payroll-meals.json
declare(strict_types=1);

date_default_timezone_set('Asia/Kolkata');
mt_srand(20261007);

function d(?string $s): ?DateTimeImmutable
{
    return $s === null ? null : new DateTimeImmutable($s.' 00:00:00');
}

/** $rates: [[effective_from, amount]] oldest first. */
function rateOn(DateTimeImmutable $day, array $rates): ?float
{
    $hit = null;
    foreach ($rates as [$from, $amount]) {
        if (d($from) <= $day) {
            $hit = $amount;
        }
    }

    return $hit === null ? null : (float) $hit;
}

function covers(array $p, DateTimeImmutable $day): bool
{
    return d($p[0]) <= $day && ($p[1] === null || d($p[1]) >= $day);
}

function countedDays(DateTimeImmutable $monthStart, ?DateTimeImmutable $joined, ?DateTimeImmutable $lastWorkingDay = null, array $skipped = [], ?array $periods = null, ?DateTimeImmutable $until = null): array
{
    $from = $monthStart->modify('first day of this month');
    $to = $monthStart->modify('last day of this month');
    if ($until !== null && $until < $to) {
        $to = $until;
    }
    if ($periods === null) {
        if ($joined !== null && $joined > $from) {
            $from = $joined;
        }
        if ($lastWorkingDay !== null && $lastWorkingDay < $to) {
            $to = $lastWorkingDay;
        }
    }
    $days = [];
    for ($day = $from; $day <= $to; $day = $day->modify('+1 day')) {
        if (in_array((int) $day->format('j'), $skipped, true)) {
            continue;
        }
        if ($periods !== null) {
            $ok = false;
            foreach ($periods as $p) {
                if (covers($p, $day) && ($p[1] !== null || $lastWorkingDay === null || $day <= $lastWorkingDay)) {
                    $ok = true;
                    break;
                }
            }
            if (! $ok) {
                continue;
            }
        }
        $days[] = (int) $day->format('j');
    }

    return $days;
}

function pricesIn(DateTimeImmutable $monthStart, array $rates): array
{
    $end = $monthStart->modify('last day of this month');
    $opening = rateOn($monthStart, $rates);
    $prices = $opening !== null ? [['from' => $monthStart->format('Y-m-d'), 'amount' => $opening]] : [];
    foreach ($rates as [$from, $amount]) {
        if (d($from) > $monthStart && d($from) <= $end) {
            $prices[] = ['from' => $from, 'amount' => (float) $amount];
        }
    }

    return $prices;
}

function note(DateTimeImmutable $monthStart, array $periods, ?DateTimeImmutable $joined, ?DateTimeImmutable $left, int $leftOut): ?string
{
    $end = $monthStart->modify('last day of this month');
    $same = fn (DateTimeImmutable $a) => $a->format('Y-m') === $monthStart->format('Y-m');
    $parts = [];
    if ($joined !== null && $same($joined)) {
        $parts[] = 'joined '.$joined->format('j M');
    }
    $openEnded = false;
    foreach ($periods as $p) {
        if ($p[1] === null) {
            $openEnded = true;
        }
    }
    if ($left !== null && $same($left) && $openEnded) {
        $parts[] = 'left '.$left->format('j M');
    }
    usort($periods, fn ($a, $b) => strcmp($a[0], $b[0]));
    foreach ($periods as $p) {
        if (d($p[0]) > $monthStart && d($p[0]) <= $end) {
            $parts[] = 'meals from '.d($p[0])->format('j M');
        }
        if ($p[1] !== null && d($p[1]) >= $monthStart && d($p[1]) < $end) {
            $parts[] = 'meals until '.d($p[1])->format('j M');
        }
    }
    if ($leftOut > 0) {
        $parts[] = $leftOut.' '.($leftOut === 1 ? 'day' : 'days').' not counted';
    }

    return $parts ? implode(', ', $parts) : null;
}

/** One person's row of the statement (:213-238). */
function row(array $c): array
{
    $start = d(sprintf('%04d-%02d-01', $c['year'], $c['month']));
    $daysInMonth = (int) $start->format('t');
    $joined = d($c['joined']);
    $left = d($c['left']);
    $until = d($c['until']);
    $counted = countedDays($start, $joined, $left, $c['skipped'], $c['periods'], $until);
    $total = 0.0;
    foreach ($counted as $day) {
        $total += (rateOn($start->setDate((int) $start->format('Y'), (int) $start->format('n'), $day), $c['rates']) ?? 0.0) / $daysInMonth;
    }
    $withoutSkips = countedDays($start, $joined, $left, [], $c['periods'], $until);
    $leftOut = count($withoutSkips) - count($counted);

    return [
        'days' => count($counted),
        'counted' => $counted,
        'leftOut' => $leftOut,
        'amount' => round($total, 2),
        'note' => note($start, $c['periods'] ?? [], $joined, $left, $leftOut),
        'prices' => pricesIn($start, $c['rates']),
        'rateAtEnd' => rateOn($start->modify('last day of this month'), $c['rates']),
    ];
}

$cases = [];
$base = ['year' => 2026, 'month' => 9, 'joined' => '2025-01-10', 'left' => null, 'until' => null, 'skipped' => [], 'rates' => [['2026-01-01', '3000.00']]];
$cases[] = ['name' => 'a full month on meals at one price'] + ['periods' => [['2026-01-01', null]]] + $base;
$cases[] = ['name' => 'the price changes on the 15th', 'periods' => [['2026-01-01', null]], 'rates' => [['2026-01-01', '3000.00'], ['2026-09-15', '3500.00']]] + $base;
$cases[] = ['name' => 'meals start on the 10th and stop on the 20th', 'periods' => [['2026-09-10', '2026-09-20']]] + $base;
$cases[] = ['name' => 'two records in the month', 'periods' => [['2026-08-01', '2026-09-05'], ['2026-09-21', null]]] + $base;
$cases[] = ['name' => 'skipped days are left out and said so', 'periods' => [['2026-01-01', null]], 'skipped' => [3, 4, 17]] + $base;
$cases[] = ['name' => 'relieved on the 12th: an open record stops there', 'periods' => [['2026-01-01', null]], 'left' => '2026-09-12'] + $base;
$cases[] = ['name' => 'relieved on the 12th: a dated record is honoured past it', 'periods' => [['2026-01-01', '2026-09-20']], 'left' => '2026-09-12'] + $base;
$cases[] = ['name' => 'joined on the 8th (a record from that day)', 'joined' => '2026-09-08', 'periods' => [['2026-09-08', null]]] + $base;
$cases[] = ['name' => 'a running month counted to the 5th', 'month' => 10, 'until' => '2026-10-05', 'periods' => [['2026-01-01', null]], 'skipped' => [2]] + $base;
$cases[] = ['name' => 'no records: the service, joined to the last day', 'periods' => null, 'joined' => '2026-09-08', 'left' => '2026-09-25'] + $base;
$cases[] = ['name' => 'a price set after the month began only', 'periods' => [['2026-01-01', null]], 'rates' => [['2026-09-10', '2800.50']]] + $base;
$cases[] = ['name' => 'February in a leap year, three prices', 'year' => 2024, 'month' => 2, 'periods' => [['2023-01-01', null]], 'rates' => [['2023-01-01', '2999.99'], ['2024-02-11', '3100.00'], ['2024-02-29', '3333.33']]] + $base;
for ($n = 0; $n < 80; $n++) {
    $year = 2025 + mt_rand(0, 1);
    $month = mt_rand(1, 12);
    $days = (int) d(sprintf('%04d-%02d-01', $year, $month))->format('t');
    $day = fn () => sprintf('%04d-%02d-%02d', $year, $month, mt_rand(1, $days));
    $rates = [['2024-01-01', number_format(mt_rand(150000, 600000) / 100, 2, '.', '')]];
    for ($i = mt_rand(0, 2); $i > 0; $i--) {
        $rates[] = [$day(), number_format(mt_rand(150000, 600000) / 100, 2, '.', '')];
    }
    usort($rates, fn ($a, $b) => strcmp($a[0], $b[0]));
    $periods = null;
    if (mt_rand(0, 5) > 0) {
        $a = $day();
        $b = $day();
        [$a, $b] = $a <= $b ? [$a, $b] : [$b, $a];
        $periods = mt_rand(0, 1) ? [[$a, $b]] : [['2024-06-01', mt_rand(0, 1) ? null : $b]];
    }
    $skipped = [];
    for ($i = mt_rand(0, 4); $i > 0; $i--) {
        $skipped[] = mt_rand(1, $days);
    }
    $cases[] = ['name' => 'generated '.$n, 'year' => $year, 'month' => $month, 'joined' => mt_rand(0, 3) ? '2024-01-01' : $day(), 'left' => mt_rand(0, 3) ? null : $day(),
        'until' => mt_rand(0, 4) ? null : $day(), 'skipped' => array_values(array_unique($skipped)), 'rates' => $rates, 'periods' => $periods];
}

$out = [];
foreach ($cases as $c) {
    $out[] = $c + ['php' => row($c)];
}
echo json_encode(['php' => PHP_VERSION, 'cases' => $out], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION), "\n";
