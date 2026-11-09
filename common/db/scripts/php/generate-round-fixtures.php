<?php
// Generates tests/server/fixtures/php-round.json from REAL PHP, using the same float expressions Pallav uses.
// Run (from the HMS folder):
//   php db/scripts/php/generate-round-fixtures.php > "web-app/tests/server/fixtures/php-round.json"
// (php prints extension warnings on stderr on this PC; they are harmless.)
//
// Every row: op, in (inputs as decimal strings, exactly as a decimal(x,2) column would hold them) and two results in paise:
//   php_native_paise : what THIS machine's PHP gives (php -v: see "phpVersion" in the output).
//   php83_paise      : what PHP 8.3 gives. Pallav's live server runs PHP 8.3 (DEPLOYMENT.md: "PHP 8.3 (8.2 is the minimum)").
//                      PHP 8.4 rewrote round() and no longer "pre-rounds" to 15 significant digits, so the two can differ on
//                      exact ties such as 83.325 whose float is 83.32499999999999. round83() below is a line-by-line port of
//                      _php_math_round() from PHP 8.3 (ext/standard/math.c) so the 8.3 behaviour can be reproduced on 8.4.
//
// Pallav expressions reproduced (file: expression):
//   room_charge              Models/Pms/Stay.php roomCharge():              round(nights * (float) rate, 2)
//   qty_price                Http/Controllers/Pms/StayController.php:159:    round((float) quantity * (float) unit_price, 2)
//   expense_line             Http/Controllers/ExpenseController.php:338,369: quantity = round(q, 3); round(quantity * price, 2)
//   expense_price_from_total ExpenseController.php:367:                      round(total / quantity, 2)
//   overtime                 Services/Payroll/OvertimeCalculator.php:        round(((float) salary / days) / hours * overtime, 2)
//   outstanding              Models/SalaryProcessing.php:95:                 max(0, round((float) net - (float) paid, 2))
//   bill_sum                 Http/Controllers/BillMasterController.php:379:  round(array_sum(array_map(float, amounts)), 2)
//   import_round             data import of decimal columns:                 round((float) x, 2)
//   occupancy                Http/Controllers/Pms/BoardController.php:29:    (int) round(occupied * 100 / inService)

mt_srand(20261005);

// ---- PHP 8.3 round() (mode PHP_ROUND_HALF_UP), ported from ext/standard/math.c ----
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
        // pre-round to 15 significant digits
        $tmp = helper_half_up(basic($value, $usePrecision));
        $usePrecision = $places - $usePrecision;
        $usePrecision = max(-4 * 15, $usePrecision);
        // because places < precisionPlaces, $usePrecision is negative here
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

// ---- Pallav's expressions, parameterised on the round function ----
function calc(string $op, array $in, callable $round): int
{
    switch ($op) {
        case 'room_charge':
            $v = $round($in['nights'] * (float) $in['rate'], 2);
            break;
        case 'qty_price':
            $v = $round((float) $in['quantity'] * (float) $in['unit_price'], 2);
            break;
        case 'expense_line':
            $q = $round((float) $in['quantity'], 3);
            $v = $round($q * (float) $in['price'], 2);
            break;
        case 'expense_price_from_total':
            $v = $round((float) $in['total'] / (float) $in['quantity'], 2);
            break;
        case 'overtime':
            $v = $round(((float) $in['salary'] / $in['days']) / (float) $in['hours'] * (float) $in['overtime'], 2);
            break;
        case 'outstanding':
            $v = max(0, $round((float) $in['net'] - (float) $in['paid'], 2));
            break;
        case 'bill_sum':
            $v = $round(array_sum(array_map('floatval', $in['amounts'])), 2);
            break;
        case 'import_round':
            $v = $round((float) $in['x'], 2);
            break;
        case 'occupancy':
            return (int) $round($in['occupied'] * 100 / $in['in_service']);
        default:
            throw new RuntimeException("unknown op $op");
    }
    return (int) round(((float) $v) * 100);
}

function money(int $paise): string
{
    $sign = $paise < 0 ? '-' : '';
    $a = abs($paise);
    return sprintf('%s%d.%02d', $sign, intdiv($a, 100), $a % 100);
}

function pick(array $list)
{
    return $list[mt_rand(0, count($list) - 1)];
}

function randPaise(): int
{
    $band = mt_rand(0, 9);
    if ($band < 4) {
        return mt_rand(1, 100000);            // up to Rs 1,000
    }
    if ($band < 8) {
        return mt_rand(1, 10000000);          // up to Rs 1,00,000
    }
    if ($band < 9) {
        return mt_rand(1, 100000000000);      // up to Rs 1,000 million
    }
    return mt_rand(1, 900000000000);          // very large
}

$cases = [];
$add = function (string $op, array $in) use (&$cases) {
    $cases[] = [$op, $in];
};

$edgeRates = ['0.01', '0.05', '0.10', '0.29', '1.00', '1.01', '1.99', '2.67', '10.05', '33.33', '99.99', '100.00', '1499.50', '2499.99', '12345.67'];
$edgeQty = ['0.01', '0.05', '0.50', '1.00', '1.50', '2.50', '3.33', '7.50', '12.25', '99.99'];

foreach ($edgeRates as $r) {
    foreach ([1, 2, 3, 7, 30] as $n) {
        $add('room_charge', ['nights' => $n, 'rate' => $r]);
    }
}
for ($i = 0; $i < 25; $i++) {
    $add('room_charge', ['nights' => mt_rand(1, 90), 'rate' => money(randPaise())]);
}

foreach ($edgeQty as $q) {
    foreach (['0.05', '1.01', '2.67', '33.33', '1499.50'] as $p) {
        $add('qty_price', ['quantity' => $q, 'unit_price' => $p]);
    }
}
for ($i = 0; $i < 25; $i++) {
    $add('qty_price', ['quantity' => money(mt_rand(1, 100000)), 'unit_price' => money(randPaise())]);
}

foreach (['0.005', '0.125', '1.005', '2.675', '0.285', '1.255', '3.333', '12.505'] as $q) {
    foreach (['1.00', '10.00', '33.33', '99.99', '0.15'] as $p) {
        $add('expense_line', ['quantity' => $q, 'price' => $p]);
    }
}
for ($i = 0; $i < 20; $i++) {
    $q = sprintf('%d.%03d', mt_rand(0, 500), mt_rand(0, 999));
    if ($q === '0.000') {
        $q = '0.001';
    }
    $add('expense_line', ['quantity' => $q, 'price' => money(mt_rand(1, 5000000))]);
}

foreach (['10.00', '100.00', '99.99', '0.01', '1234.56'] as $t) {
    foreach (['3', '7', '0.500', '1.250', '2.500', '0.125'] as $q) {
        $add('expense_price_from_total', ['total' => $t, 'quantity' => $q]);
    }
}
for ($i = 0; $i < 20; $i++) {
    $q = sprintf('%d.%03d', mt_rand(0, 300), mt_rand(0, 999));
    if ((float) $q <= 0) {
        $q = '1.000';
    }
    $add('expense_price_from_total', ['total' => money(mt_rand(1, 10000000)), 'quantity' => $q]);
}

foreach (['15000.00', '12345.67', '9999.99', '30000.00', '18500.50'] as $s) {
    foreach ([28, 30, 31] as $d) {
        foreach (['8.00', '9.00', '7.50'] as $h) {
            foreach (['1.00', '2.50', '5.00', '0.50', '12.25'] as $o) {
                $add('overtime', ['salary' => $s, 'days' => $d, 'hours' => $h, 'overtime' => $o]);
            }
        }
    }
}
for ($i = 0; $i < 30; $i++) {
    $add('overtime', ['salary' => money(mt_rand(100000, 20000000)), 'days' => pick([28, 29, 30, 31]), 'hours' => money(mt_rand(400, 1200)), 'overtime' => money(mt_rand(1, 6000))]);
}

for ($i = 0; $i < 25; $i++) {
    $add('outstanding', ['net' => money(randPaise()), 'paid' => money(randPaise())]);
}
foreach ([['100.10', '100.20'], ['0.30', '0.10'], ['0.10', '0.30'], ['1000.00', '1000.00'], ['5.00', '0.00']] as $pair) {
    $add('outstanding', ['net' => $pair[0], 'paid' => $pair[1]]);
}

foreach ([['0.10', '0.20'], ['0.10', '0.20', '0.30'], ['0.01', '0.02', '0.03', '0.04'], ['1.10', '2.20', '3.30'], ['19.99', '29.99', '39.99', '9.99'], ['0.07', '0.07', '0.07']] as $list) {
    $add('bill_sum', ['amounts' => $list]);
}
for ($i = 0; $i < 40; $i++) {
    $list = [];
    for ($j = 0, $c = mt_rand(2, 6); $j < $c; $j++) {
        $list[] = money(randPaise());
    }
    $add('bill_sum', ['amounts' => $list]);
}

foreach (['1.005', '2.675', '0.285', '1.255', '0.005', '0.015', '0.025', '0.035', '0.045', '1.115', '8.325', '10.075', '-0.005', '-1.005', '-2.675', '0.994', '0.995', '0.9949', '1234567.895', '4.0049', '4.0050', '4.0051', '9007199.255'] as $x) {
    $add('import_round', ['x' => $x]);
}
for ($i = 0; $i < 40; $i++) {
    $add('import_round', ['x' => sprintf('%s%d.%03d', mt_rand(0, 9) === 0 ? '-' : '', mt_rand(0, 100000), mt_rand(0, 999))]);
}

for ($inService = 1; $inService <= 40; $inService++) {
    for ($occ = 0; $occ <= $inService; $occ += max(1, intdiv($inService, 6))) {
        $add('occupancy', ['occupied' => $occ, 'in_service' => $inService]);
    }
}

$rows = [];
foreach ($cases as [$op, $in]) {
    $rows[] = [
        'op' => $op,
        'in' => $in,
        'php_native_paise' => calc($op, $in, 'round'),
        'php83_paise' => calc($op, $in, 'round83'),
    ];
}

echo json_encode(['phpVersion' => PHP_VERSION, 'rows' => $rows], JSON_PRETTY_PRINT), "\n";
