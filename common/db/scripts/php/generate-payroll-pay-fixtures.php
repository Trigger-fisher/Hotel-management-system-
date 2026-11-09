<?php
// Golden fixtures for the salary run, made by REAL PHP running VERBATIM copies of Pallav's arithmetic:
//   Services/Payroll/SalaryProcessor.php processEmployee (:165-288), dailySalaryScheduleFor (:290-335), applyDeductions (:337-374),
//   applyAdvances (:376-431), createCarryForward (:433-460); Services/Payroll/OvertimeCalculator.php (:9-36);
//   Models/PayrollAdvance.php outstanding() (:47-50).
// Eloquent is replaced by plain arrays (a Collection sum of decimal strings is a float sum; a decimal(…,2) column is read back as the float of
// its string); Carbon by DateTimeImmutable. Each scenario is run twice: with PHP 8.3's round() (Pallav's live server; a line-by-line port of
// ext/standard/math.c, the same as generate-round-fixtures.php) and with this machine's native round(). The tests compare HMS with "php83".
//
// Usage:  php db/scripts/php/generate-payroll-pay-fixtures.php > db/scripts/php/fixtures/payroll-pay.json
declare(strict_types=1);

date_default_timezone_set('Asia/Kolkata');
mt_srand(20261006);

// ---- PHP 8.3 round() (mode PHP_ROUND_HALF_UP), ported from ext/standard/math.c (same as generate-round-fixtures.php) ----
function p10(int $p): float
{
    static $table = [1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22];
    if ($p < 0 || $p > 22) {
        return pow(10.0, $p);
    }
    return $table[$p];
}
function helper_half_up(float $value): float
{
    return $value >= 0.0 ? floor($value + 0.5) : ceil($value - 0.5);
}
function basic(float $value, int $places): float
{
    $f1 = p10(abs($places));
    return $places >= 0 ? $value * $f1 : $value / $f1;
}
function round83(float $value, int $places = 0): float
{
    if (!is_finite($value) || $value == 0.0) {
        return $value;
    }
    $precisionPlaces = 14 - (int) floor(log10(abs($value)));
    $f1 = p10(abs($places));
    if ($precisionPlaces > $places && $precisionPlaces - 15 < $places) {
        $usePrecision = $precisionPlaces < -(4 * 15) ? -(4 * 15) : $precisionPlaces;
        $tmp = helper_half_up(basic($value, $usePrecision));
        $usePrecision = $places - $usePrecision;
        $usePrecision = max(-4 * 15, $usePrecision);
        $tmp = $tmp / p10(abs($usePrecision));
    } else {
        $tmp = $places >= 0 ? $value * $f1 : $value / $f1;
        if (abs($tmp) >= 1e15) {
            return $value;
        }
    }
    $tmp = helper_half_up($tmp);
    if (abs($places) < 23) {
        $tmp = $places > 0 ? $tmp / $f1 : $tmp * $f1;
    }
    return $tmp;
}

/** A decimal(…,2) column after a save: Laravel's decimal:2 cast (HALF_UP of the float's string), read back as a float. */
function col2(float $v, callable $round): float
{
    return (float) number_format($round($v, 2), 2, '.', '');
}

/**
 * One person's month. $s: salary (string), hours (string), year, month, entries [[day, pct, ot]], revisions [[effective_date, previous, new]]
 * (the "Salary" field, ordered by date then id), bonuses [[type, amount, remarks]], assignments [[id, name, type, amount, settled]],
 * advances [[id, date, amount, recovered, type, deduction_amount, remarks]] (unsettled, by advance_date).
 */
function run(array $s, callable $round): array
{
    $start = new DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00', $s['year'], $s['month']));
    $daysInMonth = (int) $start->format('t');
    $salary = (float) $s['salary'];
    $hours = (float) $s['hours'];

    // ---- dailySalaryScheduleFor (:290-335)
    if (! $s['revisions']) {
        $rate = $salary / $daysInMonth;
        $schedule = array_fill(1, $daysInMonth, $rate);
    } else {
        $revisions = array_values($s['revisions']);
        $value = (float) ($revisions[0][1] ?? $salary);
        $pointer = 0;
        $next = $revisions[$pointer] ?? null;
        $schedule = [];
        for ($day = 1; $day <= $daysInMonth; $day++) {
            $date = $start->modify('+'.($day - 1).' days');
            while ($next && $date >= new DateTimeImmutable($next[0].' 00:00:00')) {
                $value = (float) $next[2];
                $pointer++;
                $next = $revisions[$pointer] ?? null;
            }
            $schedule[$day] = $value / $daysInMonth;
        }
    }

    // ---- processEmployee (:165-288)
    $buckets = [0 => 0, 25 => 0, 50 => 0, 75 => 0, 100 => 0];
    $overtimeHours = 0.0;
    $attendanceSalary = 0.0;
    foreach ($s['entries'] as [$day, $pct, $ot]) {
        $percentage = (int) $pct;
        $overtimeHours += (float) $ot;
        if (! array_key_exists($percentage, $buckets)) {
            continue;
        }
        $buckets[$percentage]++;
        $attendanceSalary += ($schedule[(int) $day] ?? 0.0) * ($percentage / 100);
    }
    $attendanceSalary = $round($attendanceSalary, 2);
    $payableDays = 0.0;
    foreach ($buckets as $percentage => $count) {
        $payableDays += $count * ($percentage / 100);
    }
    $dailySalary = $daysInMonth > 0 ? $salary / $daysInMonth : 0.0;
    // OvertimeCalculator::hourlyRate / amount
    $hourlyRate = ($daysInMonth <= 0 || $hours <= 0) ? 0.0 : ($salary / $daysInMonth) / $hours;
    $overtimeAmount = $round($hourlyRate * $overtimeHours, 2);

    $bonusAmount = 0.0;
    $incentiveAmount = 0.0;
    $lines = [];
    foreach ($s['bonuses'] as [$type, $amount, $remarks]) {
        if ($type === 'Bonus') {
            $bonusAmount += (float) $amount;
        } else {
            $incentiveAmount += (float) $amount;
        }
    }
    foreach ($s['bonuses'] as [$type, $amount, $remarks]) {
        $lines[] = ['category' => $type, 'label' => $remarks ?: $type, 'type' => null, 'amount' => (float) $amount, 'pending' => 0.0];
    }
    $gross = $attendanceSalary + $overtimeAmount + $bonusAmount + $incentiveAmount;

    // ---- applyDeductions (:337-374)
    $total = 0.0;
    $settledNow = [];
    foreach ($s['assignments'] as [$id, $name, $type, $amount, $settled]) {
        if ($type === 'One Time' && $settled) {
            continue;
        }
        $amount = (float) $amount;
        if ($amount <= 0) {
            continue;
        }
        $total += $amount;
        $lines[] = ['category' => 'Deduction', 'label' => $name ?? 'Deduction', 'type' => $type, 'amount' => $amount, 'pending' => 0.0];
        if ($type === 'One Time') {
            $settledNow[] = $id;
        }
    }
    $deductionTotal = $round($total, 2);
    $afterDeductions = max(0, $gross - $deductionTotal);

    // ---- applyAdvances (:376-431) + createCarryForward (:433-460)
    $advances = array_values(array_filter($s['advances'], fn ($a) => max(0, (float) $a[2] - (float) $a[3]) > 0.001));
    $remainingBudget = $afterDeductions;
    $totalDeducted = 0.0;
    $totalCarried = 0.0;
    $advanceOut = [];
    $carry = [];
    $nextMonthFirst = $start->modify('first day of next month')->format('Y-m-d');
    foreach ($advances as [$id, $date, $amount, $recovered, $type, $instalmentAmount, $remarks]) {
        $recovered = (float) $recovered;
        $outstanding = max(0, (float) $amount - $recovered);
        $instalment = $type === 'Monthly' ? min((float) $instalmentAmount, $outstanding) : $outstanding;
        $deducted = max(0, min($instalment, $remainingBudget));
        if ($deducted > 0.001) {
            $recovered = $recovered + $deducted;
            $lines[] = ['category' => 'Advance', 'label' => $remarks ?: 'Salary Advance', 'type' => $type, 'amount' => $round($deducted, 2), 'pending' => $round($outstanding - $deducted, 2)];
            $remainingBudget -= $deducted;
            $totalDeducted += $deducted;
        }
        $remainder = $outstanding - $deducted;
        if ($remainder > 0.001) {
            $recovered = $recovered + $remainder;
            $carry[] = [
                'parent' => $id,
                'date' => $nextMonthFirst,
                'amount' => $round($remainder, 2),
                'type' => $type,
                'deductionAmount' => min((float) $instalmentAmount, $round($remainder, 2)),
                'remarks' => 'Carry Forward from Previous Month'.($remarks ? ' - '.$remarks : ''),
            ];
            $totalCarried += $remainder;
        }
        $advanceOut[] = ['id' => $id, 'recovered' => col2($recovered, $round), 'settled' => true];
    }
    $advanceDeducted = $round($totalDeducted, 2);
    $pendingAdvance = $round($totalCarried, 2);
    $netSalary = max(0, $afterDeductions - $advanceDeducted);

    return [
        'daysInMonth' => $daysInMonth,
        'buckets' => array_values($buckets),
        'payableDays' => col2($payableDays, $round),
        'attendanceSalary' => $attendanceSalary,
        'dailySalary' => $round($dailySalary, 2),
        'hourlyRate' => $round($hourlyRate, 2),
        'overtimeHours' => col2($overtimeHours, $round),
        'overtimeAmount' => $overtimeAmount,
        'bonus' => col2($bonusAmount, $round),
        'incentive' => col2($incentiveAmount, $round),
        'deduction' => $deductionTotal,
        'advanceDeducted' => $advanceDeducted,
        'pendingAdvance' => $pendingAdvance,
        'net' => $round($netSalary, 2),
        'lines' => array_map(fn ($l) => ['category' => $l['category'], 'label' => $l['label'], 'type' => $l['type'], 'amount' => col2($l['amount'], $round), 'pending' => col2($l['pending'], $round)], $lines),
        'settled' => $settledNow,
        'advances' => $advanceOut,
        'carry' => array_map(fn ($c) => array_merge($c, ['deductionAmount' => col2($c['deductionAmount'], $round)]), $carry),
    ];
}

// ---- scenarios ------------------------------------------------------------------------------------------------------------------------
$money = fn (int $lo, int $hi): string => number_format(mt_rand($lo, $hi) / 100, 2, '.', '');
$pcts = [0, 25, 50, 75, 100, 100, 100, 100, 50, 0];
$scenarios = [];

// hand-made edges first
$scenarios[] = ['name' => 'flat month, all present, no extras', 'salary' => '30000.00', 'hours' => '8.00', 'year' => 2026, 'month' => 9,
    'entries' => array_map(fn ($d) => [$d, 100, '0'], range(1, 30)), 'revisions' => [], 'bonuses' => [], 'assignments' => [], 'advances' => []];
$scenarios[] = ['name' => 'Pallav tie: 30000 over 28 days, 12.25 overtime hours (1640.625)', 'salary' => '30000.00', 'hours' => '8.00', 'year' => 2026, 'month' => 2,
    'entries' => array_merge([[1, 100, '12.25']], array_map(fn ($d) => [$d, 100, '0'], range(2, 28))), 'revisions' => [], 'bonuses' => [], 'assignments' => [], 'advances' => []];
$scenarios[] = ['name' => 'mid-month revision from the 16th, and one after the month', 'salary' => '36000.00', 'hours' => '9.00', 'year' => 2026, 'month' => 7,
    'entries' => array_map(fn ($d) => [$d, $d % 7 === 0 ? 0 : 100, '0'], range(1, 31)),
    'revisions' => [['2026-07-16', '31000.00', '33000.00']], 'bonuses' => [], 'assignments' => [], 'advances' => []];
$scenarios[] = ['name' => 'two revisions in a month, the first with no previous value', 'salary' => '41000.00', 'hours' => '8.00', 'year' => 2024, 'month' => 2,
    'entries' => array_map(fn ($d) => [$d, $pcts[$d % 10], (string) ($d % 3)], range(1, 29)),
    'revisions' => [['2024-02-01', null, '28000.00'], ['2024-02-20', '28000.00', '29500.50']], 'bonuses' => [], 'assignments' => [], 'advances' => []];
$scenarios[] = ['name' => 'deductions bigger than the salary: net 0, every advance carried forward', 'salary' => '12000.00', 'hours' => '8.00', 'year' => 2026, 'month' => 6,
    'entries' => array_map(fn ($d) => [$d, $d < 10 ? 100 : 0, '0'], range(1, 30)), 'revisions' => [], 'bonuses' => [['Bonus', '500.00', '']],
    'assignments' => [[1, 'PF', 'Monthly', '1800.00', false], [2, 'Uniform', 'One Time', '5000.00', false], [3, 'Canteen', 'One Time', '700.00', true], [4, null, 'Monthly', '0.00', false]],
    'advances' => [[11, '2026-05-10 10:00:00', '10000.00', '0.00', 'Monthly', '2500.00', 'Festival'], [12, '2026-06-02 09:30:00', '3000.00', '0.00', 'One Time', '3000.00', '']]];
$scenarios[] = ['name' => 'advances partly recovered, a Monthly instalment larger than what is left, a settled-out advance skipped', 'salary' => '25000.00', 'hours' => '10.00', 'year' => 2026, 'month' => 8,
    'entries' => array_map(fn ($d) => [$d, 100, $d % 5 === 0 ? '1.5' : '0'], range(1, 31)), 'revisions' => [],
    'bonuses' => [['Incentive', '1250.75', 'Upsell'], ['Bonus', '2000.00', 'Diwali']],
    'assignments' => [[1, 'PF', 'Monthly', '1800.00', false]],
    'advances' => [[21, '2026-03-01 00:00:00', '9000.00', '7500.00', 'Monthly', '2000.00', 'Bike'], [22, '2026-04-01 00:00:00', '5000.00', '5000.00', 'Monthly', '1000.00', ''], [23, '2026-08-03 12:00:00', '20000.00', '0.00', 'One Time', '20000.00', 'Medical']]];
$scenarios[] = ['name' => 'no entries at all', 'salary' => '18000.00', 'hours' => '8.00', 'year' => 2026, 'month' => 4,
    'entries' => [], 'revisions' => [], 'bonuses' => [], 'assignments' => [], 'advances' => []];
$scenarios[] = ['name' => 'an odd percentage the buckets do not know is skipped, its overtime still counts', 'salary' => '22222.22', 'hours' => '7.50', 'year' => 2026, 'month' => 1,
    'entries' => [[1, 100, '2.25'], [2, 60, '3'], [3, 25, '0'], [4, 75, '0.5']], 'revisions' => [], 'bonuses' => [], 'assignments' => [], 'advances' => []];

// generated
for ($n = 0; $n < 120; $n++) {
    $year = 2024 + mt_rand(0, 2);
    $month = mt_rand(1, 12);
    $days = (int) (new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month)))->format('t');
    $entries = [];
    for ($d = 1; $d <= $days; $d++) {
        if (mt_rand(0, 20) === 0) {
            continue;
        }
        $entries[] = [$d, $pcts[mt_rand(0, 9)], mt_rand(0, 6) === 0 ? number_format(mt_rand(0, 1200) / 100, 2, '.', '') : '0'];
    }
    $revisions = [];
    if (mt_rand(0, 2) === 0) {
        $k = mt_rand(1, 2);
        $prev = $money(800000, 6000000);
        $dates = [];
        for ($i = 0; $i < $k; $i++) {
            $dates[] = sprintf('%04d-%02d-%02d', $year, $month, mt_rand(1, $days));
        }
        sort($dates);
        foreach ($dates as $date) {
            $new = $money(800000, 6000000);
            $revisions[] = [$date, $prev, $new];
            $prev = $new;
        }
    }
    $bonuses = [];
    for ($i = mt_rand(0, 3); $i > 0; $i--) {
        $bonuses[] = [mt_rand(0, 1) ? 'Bonus' : 'Incentive', $money(1000, 800000), mt_rand(0, 1) ? 'Note '.$i : ''];
    }
    $assignments = [];
    for ($i = 1, $k = mt_rand(0, 3); $i <= $k; $i++) {
        $assignments[] = [$i, mt_rand(0, 4) ? 'Ded '.$i : null, mt_rand(0, 1) ? 'Monthly' : 'One Time', $money(0, 500000), mt_rand(0, 3) === 0];
    }
    $advances = [];
    for ($i = 1, $k = mt_rand(0, 3); $i <= $k; $i++) {
        $amount = mt_rand(100000, 4000000);
        $recovered = mt_rand(0, 2) === 0 ? mt_rand(0, $amount) : 0;
        $type = mt_rand(0, 1) ? 'Monthly' : 'One Time';
        $advances[] = [100 + $i, sprintf('%04d-%02d-%02d 10:00:00', $year, $month, $i), number_format($amount / 100, 2, '.', ''), number_format($recovered / 100, 2, '.', ''), $type,
            $type === 'Monthly' ? $money(10000, 800000) : number_format($amount / 100, 2, '.', ''), mt_rand(0, 1) ? 'Adv '.$i : ''];
    }
    $scenarios[] = ['name' => 'generated '.$n, 'salary' => $money(500000, 9000000), 'hours' => number_format(mt_rand(1, 48) / 4, 2, '.', ''), 'year' => $year, 'month' => $month,
        'entries' => $entries, 'revisions' => $revisions, 'bonuses' => $bonuses, 'assignments' => $assignments, 'advances' => $advances];
}

$out = [];
foreach ($scenarios as $s) {
    $out[] = $s + ['php83' => run($s, 'round83'), 'native' => run($s, 'round')];
}
echo json_encode(['php' => PHP_VERSION, 'scenarios' => $out], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION), "\n";
