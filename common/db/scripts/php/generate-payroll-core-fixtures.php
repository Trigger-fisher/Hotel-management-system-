<?php
// Golden fixtures for Payroll core, made by REAL PHP:
// - PhoneCountries (Support/PhoneCountries.php) is required VERBATIM from db/scripts/php/pallav/PhoneCountries.php (a byte copy of
//   Pallav's file; it needs nothing from Laravel): all(), split(), normalise(), check(), message(), pattern(), format() over every
//   country's sample, its edges and the PhoneNumberTest / StaffFormTest cases.
// - The attendance save's cell rule (AttendanceController::save :70-125): keys upper-cased and trimmed, unknown keys listed once each
//   in the order met, days outside 1..daysInMonth skipped, an empty key with no overtime clears the cell, otherwise the status is
//   copied onto the day (key, percentage, skips_food) with (float) overtime. Copied with Collection calls as plain arrays.
// - Progress (PayrollDashboardController::attendanceProgress :62-80, AttendanceController::index :33-50): PHP round() half away from 0.
// - AttendanceMonth::isComplete (:72-75) and daysInMonth over month ends and leap years, with Carbon as DateTimeImmutable.
//
// Usage:  php db/scripts/php/generate-payroll-core-fixtures.php > db/scripts/php/fixtures/payroll-core.json
declare(strict_types=1);

namespace {
    require __DIR__.'/pallav/PhoneCountries.php';

    use App\Support\PhoneCountries;

    date_default_timezone_set('Asia/Kolkata');

    // ---- phones ---------------------------------------------------------------------------------------------------------------------
    $inputs = [
        // [raw, selected]
        ['98765 43210', null], ['+91 98765 43210', null], ['+971 50 123 4567', '91'], ['7400 123456', '44'], ['0044 7400 123456', null],
        ['919876543210', null], ['9198765432', null], ['098765-43210', null], ['5876543210', null], ['12345', null], ['5012345', '971'],
        ['81234567', '65'], ['+999123456', null], ['+1 201 555 0123', null], ['', null], ['   ', '44'], ['abc', null], ['98765 43210', '999'],
        ['+919876543210', '44'], ['00971501234567', null], ['0501234567', '971'], ['971501234567', '971'], ['+7 912 345 6789', null],
        ['+64 21 123 4567', null], ['+64 2112345', null], ['+62 812 3456 7890 12', null], ['+880 1712 345678', null], ['+4407400123456', null],
        ['+91 (987) 654-3210', null], ['0 98765 43210', '91'], ['++91 98765 43210', null], ['0091 98765 43210', '44'], ['919876543210', '44'],
    ];
    foreach (PhoneCountries::all() as $c) {
        $digits = preg_replace('/\D+/', '', $c['sample']);
        $inputs[] = [$c['sample'], $c['dial']];
        $inputs[] = ['+'.$c['dial'].' '.$c['sample'], null];
        $inputs[] = ['0'.$digits, $c['dial']];
        $inputs[] = [$c['dial'].$digits, $c['dial']];
        $inputs[] = [substr($digits, 0, -1), $c['dial']];
        $inputs[] = [$digits.'1', $c['dial']];
        $inputs[] = ['1'.substr($digits, 1), $c['dial']];
    }
    $phones = [];
    foreach ($inputs as [$raw, $selected]) {
        [$dial, $national] = PhoneCountries::normalise($raw, $selected);
        $phones[] = [
            'raw' => $raw, 'selected' => $selected,
            'split' => PhoneCountries::split($raw),
            'dial' => $dial, 'national' => $national,
            'error' => PhoneCountries::check($dial, $national),
            'format' => PhoneCountries::format($dial, $national),
        ];
    }
    $countries = [];
    foreach (PhoneCountries::all() as $c) {
        $countries[] = $c + ['message' => PhoneCountries::message($c['dial']), 'pattern' => PhoneCountries::pattern($c['dial'])];
    }
    $fallback = ['message' => PhoneCountries::message('999'), 'pattern' => PhoneCountries::pattern(null), 'format' => PhoneCountries::format('999', '12345')];

    // ---- the attendance save's cells (AttendanceController::save) --------------------------------------------------------------------
    $statuses = [
        ['id' => 's1', 'shortcut_key' => 'P', 'attendance_percentage' => 100, 'skips_food' => false, 'is_active' => true],
        ['id' => 's2', 'shortcut_key' => 'hd', 'attendance_percentage' => 50, 'skips_food' => false, 'is_active' => true],
        ['id' => 's3', 'shortcut_key' => 'A', 'attendance_percentage' => 0, 'skips_food' => true, 'is_active' => true],
        ['id' => 's4', 'shortcut_key' => 'L', 'attendance_percentage' => 100, 'skips_food' => true, 'is_active' => false],
    ];
    $save = function (array $attendance, array $overtime, int $daysInMonth) use ($statuses): array {
        // ->where('is_active', true)->get()->keyBy(fn ($status) => strtoupper($status->shortcut_key))
        $byKey = [];
        foreach ($statuses as $s) {
            if ($s['is_active']) {
                $byKey[strtoupper($s['shortcut_key'])] = $s;
            }
        }
        $unknownKeys = [];
        foreach ($attendance as $employeeId => $days) {
            foreach ($days as $day => $key) {
                $key = strtoupper(trim((string) $key));
                if ($key !== '' && ! isset($byKey[$key])) {
                    $unknownKeys[$key] = $key;
                }
            }
        }
        if ($unknownKeys) {
            $list = implode(', ', $unknownKeys);

            return ['error' => "Unknown attendance status shortcut key(s): {$list}. Only keys configured in Attendance Status Master are allowed."];
        }
        $writes = [];
        foreach ($attendance as $employeeId => $days) {
            foreach ($days as $day => $key) {
                $day = (int) $day;
                if ($day < 1 || $day > $daysInMonth) {
                    continue;
                }
                $key = strtoupper(trim((string) $key));
                $status = $key === '' ? null : $byKey[$key];
                $hours = (float) ($overtime[$employeeId][$day] ?? 0);
                if ($status === null && $hours <= 0) {
                    $writes[] = ['employee' => (string) $employeeId, 'day' => $day, 'clear' => true];
                    continue;
                }
                $writes[] = [
                    'employee' => (string) $employeeId, 'day' => $day, 'clear' => false,
                    'status' => $status['id'] ?? null, 'shortcut_key' => $status['shortcut_key'] ?? null,
                    'attendance_percentage' => $status['attendance_percentage'] ?? 0,
                    'skips_food' => (bool) ($status['skips_food'] ?? false), 'overtime_hours' => $hours,
                ];
            }
        }

        return ['writes' => $writes];
    };
    $saveCases = [
        ['attendance' => ['e1' => [1 => 'p', 2 => ' HD ', 3 => '', 4 => 'a']], 'overtime' => ['e1' => [3 => '2.5', 4 => '1']], 'days' => 30],
        ['attendance' => ['e1' => [1 => 'P', 2 => 'X', 3 => 'l', 4 => 'x', 5 => 'zz']], 'overtime' => [], 'days' => 31],
        ['attendance' => ['e1' => [0 => 'P', 29 => 'P', 30 => 'P', 31 => 'P']], 'overtime' => [], 'days' => 29],
        ['attendance' => ['e1' => [1 => '', 2 => null], 'e2' => [1 => 'A']], 'overtime' => ['e1' => [1 => '0', 2 => '-3'], 'e2' => [1 => '0.75']], 'days' => 28],
        ['attendance' => ['e1' => [5 => 'Hd']], 'overtime' => ['e1' => [5 => 'abc']], 'days' => 31],
    ];
    $saves = [];
    foreach ($saveCases as $c) {
        $saves[] = $c + ['result' => $save($c['attendance'], $c['overtime'], $c['days'])];
    }

    // ---- progress and month completeness --------------------------------------------------------------------------------------------
    $progress = [];
    foreach ([[0, 0], [0, 10], [1, 3], [5, 8], [1, 200], [3, 200], [199, 200], [250, 200], [45, 90], [7, 14], [1, 8], [3, 8], [5, 40]] as [$filled, $expected]) {
        $progress[] = ['filled' => $filled, 'expected' => $expected,
            'percent' => $expected === 0 ? 0 : min(100, (int) round($filled / $expected * 100))];
    }
    $months = [];
    foreach ([[2026, 2, '2026-02-27'], [2026, 2, '2026-02-28'], [2024, 2, '2024-02-28'], [2024, 2, '2024-02-29'], [2026, 9, '2026-09-29'],
        [2026, 9, '2026-09-30'], [2026, 9, '2026-10-01'], [2026, 10, '2026-10-05'], [2026, 12, '2026-12-31'], [2025, 12, '2026-01-01'], [2027, 1, '2026-10-05']] as [$y, $m, $today]) {
        $start = new DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00', $y, $m));
        $daysInMonth = (int) $start->format('t');
        $now = new DateTimeImmutable($today.' 15:30:00');
        $isCurrent = $now->format('Y-m') === $start->format('Y-m');
        $months[] = [
            'year' => $y, 'month' => $m, 'today' => $today, 'daysInMonth' => $daysInMonth,
            // now()->startOfDay()->gte($this->startDate()->endOfMonth()->startOfDay())
            'isComplete' => $now->setTime(0, 0) >= $start->modify('last day of this month')->setTime(0, 0),
            // $isCurrentMonth ? min($daysInMonth, now()->day) : $daysInMonth
            'daysExpected' => $isCurrent ? min($daysInMonth, (int) $now->format('j')) : $daysInMonth,
        ];
    }

    echo json_encode([
        'php' => PHP_VERSION,
        'phones' => $phones, 'countries' => $countries, 'fallback' => $fallback,
        'saves' => $saves, 'progress' => $progress, 'months' => $months,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION), "\n";
}
