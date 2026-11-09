<?php
// Golden fixtures for the Company Ledger, made by REAL PHP running VERBATIM copies of Pallav's Support/CompanyLedger.php build() (:114-224),
// totals() (:83-95), period() (:103-112), modes() (:244-251) and CompanyLedgerController::searchLines() (:134-158). The class itself needs
// Laravel's Collection and Carbon (not installed here), so each method body is copied with Collection calls written as the plain-array
// equivalents Laravel runs (sortBy with several comparators = a stable usort over the same comparators; sum = array_sum of floats), and
// Carbon as DateTimeImmutable at the start of the day. Money is PHP floats exactly as Pallav adds them; the JSON carries paise.
//
// Usage:  php db/scripts/php/generate-companies-fixtures.php > db/scripts/php/fixtures/companies.json
declare(strict_types=1);

date_default_timezone_set('Asia/Kolkata');
const CO = 1;
$paise = fn ($v) => (int) round(((float) $v) * 100);
$day = fn (?string $d) => $d === null ? null : new DateTimeImmutable($d.' 00:00:00');

// ---- the records (as Bill Master stores them: decimals as strings, dates as Y-m-d) ------------------------------------------------
$advances = [
    // own advance, both sides, two modes
    ['id' => 11, 'entry' => 1, 'company_id' => CO, 'receipt_number' => '2026 / 801', 'guest_name' => 'Ravi Mehta', 'room_number' => '204', 'payment_date' => '2026-09-01',
        'hotel_amount' => '5000.00', 'food_amount' => '500.50', 'hotel_mode' => 'upi', 'food_mode' => 'CASH', 'instruction' => 'Booking advance',
        'hotel_refund_amount' => null, 'food_refund_amount' => null, 'refund_payment_date' => null, 'refund_guest_name' => null, 'hotel_refund_mode' => null, 'food_refund_mode' => null, 'refund_instruction' => null],
    // own advance later partly refunded
    ['id' => 12, 'entry' => 2, 'company_id' => CO, 'receipt_number' => '2026 / 802', 'guest_name' => 'Neha Shah', 'room_number' => null, 'payment_date' => '2026-09-05',
        'hotel_amount' => '3000.00', 'food_amount' => '0.00', 'hotel_mode' => 'Card', 'food_mode' => null, 'instruction' => null,
        'hotel_refund_amount' => '1200.25', 'food_refund_amount' => null, 'refund_payment_date' => '2026-09-20', 'refund_guest_name' => 'Neha S.', 'hotel_refund_mode' => 'bank transfer', 'food_refund_mode' => null, 'refund_instruction' => 'Cancelled night'],
    // an overpayment's "Excessive / ..." advance: never a credit line; a refund of it is a debit
    ['id' => 13, 'entry' => 3, 'company_id' => CO, 'receipt_number' => 'Excessive / 2026 / 1190', 'guest_name' => 'Arjun Rao', 'room_number' => null, 'payment_date' => '2026-09-25',
        'hotel_amount' => '250.00', 'food_amount' => '0.00', 'hotel_mode' => null, 'food_mode' => null, 'instruction' => null,
        'hotel_refund_amount' => '250.00', 'food_refund_amount' => '0.00', 'refund_payment_date' => '2026-09-28', 'refund_guest_name' => null, 'hotel_refund_mode' => 'Cash', 'food_refund_mode' => null, 'refund_instruction' => null],
    // a refund of 0 is no line
    ['id' => 14, 'entry' => 4, 'company_id' => CO, 'receipt_number' => '2026 / 804', 'guest_name' => 'Om Patel', 'room_number' => '101', 'payment_date' => '2026-10-01',
        'hotel_amount' => '1000.00', 'food_amount' => '0.00', 'hotel_mode' => 'Cash', 'food_mode' => null, 'instruction' => null,
        'hotel_refund_amount' => '0.00', 'food_refund_amount' => null, 'refund_payment_date' => '2026-10-02', 'refund_guest_name' => null, 'hotel_refund_mode' => null, 'food_refund_mode' => null, 'refund_instruction' => null],
];
$bills = [
    // on account (Debit) both sides, uses the company's OWN advance 11, settled in two instalments
    ['id' => 21, 'entry' => 1, 'company_id' => CO, 'bill_number' => '2026 / 1188', 'bill_date' => '2026-09-01', 'guest_name' => 'Ravi Mehta', 'room_number' => '204', 'instruction' => 'GST bill',
        'total_hotel_amount' => '8000.00', 'total_food_amount' => '1500.00', 'hotel_mode_of_payment' => 'Debit', 'food_mode_of_payment' => 'debit',
        'advance_hotel_amount' => '5000.00', 'advance_food_amount' => '500.50', 'advance_receipt_number' => '2026 / 801', 'advance_company_id' => CO,
        'debit' => [['2026-09-10', '2000.00', '500.00', 'neft', 'Cash'], ['2026-09-15', '1000.00', '499.50', 'UPI', null], [null, '0', '0', null, null], [null, null, null, null, null], [null, null, null, null, null]],
        'debit_instruction' => 'Cheque 4411'],
    // paid at checkout in cash, an advance held under ANOTHER company's name used on it (credit "adjusted")
    ['id' => 22, 'entry' => 2, 'company_id' => CO, 'bill_number' => '2026 / 1189', 'bill_date' => '2026-09-05', 'guest_name' => 'Neha Shah', 'room_number' => '305', 'instruction' => null,
        'total_hotel_amount' => '4500.75', 'total_food_amount' => '0.00', 'hotel_mode_of_payment' => 'Cash', 'food_mode_of_payment' => null,
        'advance_hotel_amount' => '1500.00', 'advance_food_amount' => '0.00', 'advance_receipt_number' => '2026 / 777', 'advance_company_id' => 9,
        'debit' => [[null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null]],
        'debit_instruction' => null],
    // the same day as advance 12 (order: advance, bill, checkout); hotel on account, food paid by card
    ['id' => 23, 'entry' => 3, 'company_id' => CO, 'bill_number' => '2026 / 1190', 'bill_date' => '2026-09-05', 'guest_name' => 'Arjun Rao', 'room_number' => '110', 'instruction' => null,
        'total_hotel_amount' => '0.10', 'total_food_amount' => '0.20', 'hotel_mode_of_payment' => 'Debit', 'food_mode_of_payment' => 'card',
        'advance_hotel_amount' => '0.00', 'advance_food_amount' => '0.00', 'advance_receipt_number' => null, 'advance_company_id' => null,
        'debit' => [['2026-09-25', '0.35', '0', 'Cash', null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null]],
        'debit_instruction' => null],
    // no bill date: left out
    ['id' => 24, 'entry' => 4, 'company_id' => CO, 'bill_number' => '2026 / 1191', 'bill_date' => null, 'guest_name' => 'Ghost', 'room_number' => null, 'instruction' => null,
        'total_hotel_amount' => '999.00', 'total_food_amount' => '0.00', 'hotel_mode_of_payment' => 'Cash', 'food_mode_of_payment' => null,
        'advance_hotel_amount' => '0.00', 'advance_food_amount' => '0.00', 'advance_receipt_number' => null, 'advance_company_id' => null,
        'debit' => [[null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null]],
        'debit_instruction' => null],
    // October: paid at checkout, the advance covered more than the side (nothing due at the desk)
    ['id' => 25, 'entry' => 5, 'company_id' => CO, 'bill_number' => '2026 / 1200', 'bill_date' => '2026-10-02', 'guest_name' => 'Om Patel', 'room_number' => '101', 'instruction' => null,
        'total_hotel_amount' => '900.00', 'total_food_amount' => '0.00', 'hotel_mode_of_payment' => 'Cash', 'food_mode_of_payment' => null,
        'advance_hotel_amount' => '900.00', 'advance_food_amount' => '0.00', 'advance_receipt_number' => '2026 / 804', 'advance_company_id' => CO,
        'debit' => [[null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null]],
        'debit_instruction' => null],
];

// ---- modes() :244-251, verbatim ----------------------------------------------------------------------------------------------------
function modes(?string ...$modes): ?string
{
    $named = [];
    foreach ($modes as $m) {
        $m = trim((string) $m);
        if ($m === '') continue;
        $m = ucfirst(strtolower($m)) === 'Upi' ? 'UPI' : ucfirst(strtolower($m));
        if (! in_array($m, $named, true)) $named[] = $m;
    }

    return $named === [] ? null : implode(', ', $named);
}

// ---- build() :114-224, verbatim ----------------------------------------------------------------------------------------------------
const ORDER = ['advance' => 1, 'bill' => 2, 'adjusted' => 3, 'checkout' => 3, 'settlement' => 4, 'refund' => 5];
function line(string $kind, string $date, array $record, array $data): array
{
    // line() :232: 'entry' => $record->entryNumber(), the four-digit zero-padded number (HasEntryNumber::entryNumber)
    return $data + ['kind' => $kind, 'date' => $date, 'id' => $record['id'], 'entry' => str_pad((string) $record['entry'], 4, '0', STR_PAD_LEFT), 'guest' => null, 'room' => null, 'mode' => null, 'note' => null, 'debit' => 0.0, 'credit' => 0.0, 'order' => 0];
}
function build(int $companyId, array $bills, array $advances): array
{
    $lines = [];
    foreach ($advances as $a) {
        $paidIn = (float) $a['hotel_amount'] + (float) $a['food_amount'];
        if (! str_starts_with((string) $a['receipt_number'], 'Excessive / ') && $paidIn > 0 && $a['payment_date']) {
            $lines[] = line('advance', $a['payment_date'], $a, ['ref' => 'Receipt '.$a['receipt_number'], 'guest' => $a['guest_name'], 'room' => $a['room_number'], 'mode' => modes($a['hotel_mode'], $a['food_mode']), 'note' => $a['instruction'], 'credit' => $paidIn]);
        }
        $refund = (float) $a['hotel_refund_amount'] + (float) $a['food_refund_amount'];
        if ($a['refund_payment_date'] && $refund > 0) {
            $lines[] = line('refund', $a['refund_payment_date'], $a, ['ref' => 'Receipt '.$a['receipt_number'], 'guest' => $a['refund_guest_name'] ?: $a['guest_name'], 'room' => $a['room_number'], 'mode' => modes($a['hotel_refund_mode'], $a['food_refund_mode']), 'note' => $a['refund_instruction'], 'debit' => $refund]);
        }
    }
    foreach ($bills as $b) {
        if (! $b['bill_date']) continue;
        $base = ['ref' => 'Bill '.$b['bill_number'], 'guest' => $b['guest_name'], 'room' => $b['room_number']];
        $hotel = (float) $b['total_hotel_amount'];
        $food = (float) $b['total_food_amount'];
        $lines[] = line('bill', $b['bill_date'], $b, $base + ['mode' => modes($b['hotel_mode_of_payment'], $b['food_mode_of_payment']), 'note' => $b['instruction'], 'debit' => $hotel + $food]);
        $fromAdvance = (float) $b['advance_hotel_amount'] + (float) $b['advance_food_amount'];
        $ownAdvance = $b['advance_company_id'] !== null && (int) $b['advance_company_id'] === $companyId;
        if ($fromAdvance > 0 && ! $ownAdvance) {
            $lines[] = line('adjusted', $b['bill_date'], $b, ['ref' => 'Receipt '.$b['advance_receipt_number'], 'note' => 'Used on bill '.$b['bill_number'], 'credit' => $fromAdvance] + $base);
        }
        $paid = 0.0;
        $modes = [];
        foreach (['hotel' => $hotel, 'food' => $food] as $side => $total) {
            $mode = $b["{$side}_mode_of_payment"];
            if (strtolower((string) $mode) === 'debit') continue;
            $due = $total - (float) $b["advance_{$side}_amount"];
            if ($due > 0) {
                $paid += $due;
                $modes[] = $mode;
            }
        }
        if ($paid > 0) {
            $lines[] = line('checkout', $b['bill_date'], $b, $base + ['mode' => modes(...$modes), 'credit' => $paid]);
        }
        foreach (range(0, 4) as $i) {
            [$date, $h, $f, $hm, $fm] = $b['debit'][$i];
            $amount = (float) $h + (float) $f;
            if ($amount <= 0 || ! $date) continue;
            $lines[] = line('settlement', $date, $b, $base + ['mode' => modes($hm, $fm), 'note' => $i === 0 ? $b['debit_instruction'] : null, 'credit' => $amount, 'order' => $i]);
        }
    }
    usort($lines, fn ($x, $y) => [$x['date'], ORDER[$x['kind']], $x['id'], $x['order']] <=> [$y['date'], ORDER[$y['kind']], $y['id'], $y['order']]);
    $running = 0.0;
    foreach ($lines as &$l) {
        $running = round($running + $l['debit'] - $l['credit'], 2);
        $l['balance'] = $running;
    }

    return $lines;
}
// Pallav's sortBy compares the timestamp, then ORDER, then [id, order]; a 'adjusted' line carries the BILL's id, as here (line() :231)
function totals(array $lines): array
{
    $billed = (float) array_sum(array_column(array_filter($lines, fn ($l) => $l['kind'] === 'bill'), 'debit'));
    $refunded = (float) array_sum(array_column(array_filter($lines, fn ($l) => $l['kind'] === 'refund'), 'debit'));
    $received = (float) array_sum(array_column($lines, 'credit'));

    return ['billed' => $billed, 'received' => $received, 'refunded' => $refunded, 'balance' => round($billed + $refunded - $received, 2)];
}
function period(array $lines, ?string $from, ?string $to): array
{
    $before = $from ? array_values(array_filter($lines, fn ($l) => $l['date'] < $from)) : [];
    $opening = $before === [] ? 0.0 : (float) end($before)['balance'];
    $in = array_values(array_filter($lines, fn ($l) => (! $from || $l['date'] >= $from) && (! $to || $l['date'] <= $to)));
    $closing = $in === [] ? $opening : (float) end($in)['balance'];

    return ['opening' => $opening, 'lines' => $in, 'closing' => $closing];
}
const KIND_LABEL = ['bill' => 'Bill', 'advance' => 'Advance', 'checkout' => 'Paid at checkout', 'adjusted' => 'Advance used', 'settlement' => 'Payment', 'refund' => 'Refund'];
function searchLines(array $lines, string $text): array
{
    $words = preg_split('/\s+/', mb_strtolower($text), -1, PREG_SPLIT_NO_EMPTY);

    return array_values(array_filter($lines, function ($line) use ($words) {
        $d = new DateTimeImmutable($line['date']);
        $haystack = mb_strtolower(implode(' ', [$line['guest'], $line['room'] ? 'room '.$line['room'] : '', $line['ref'], $line['mode'], $line['note'], KIND_LABEL[$line['kind']], '#'.$line['entry'],
            $d->format('d-m-Y'), $d->format('d/m/Y'), $d->format('Y-m-d'), $d->format('d M Y')]));
        $amount = $line['debit'] ?: $line['credit'];
        foreach ($words as $word) {
            $number = str_replace([',', '₹', '#'], '', $word);
            $isAmount = is_numeric($number) && (float) $number === (float) $amount;
            $isEntry = ctype_digit($number) && $number === ltrim((string) $line['entry'], '0');
            if (! str_contains($haystack, $word) && ! $isAmount && ! $isEntry) return false;
        }

        return true;
    }));
}

$lines = build(CO, $bills, $advances);
$asJson = fn (array $l) => ['kind' => $l['kind'], 'date' => $l['date'], 'id' => $l['id'], 'entry' => (int) $l['entry'], 'ref' => $l['ref'], 'guest' => $l['guest'], 'room' => $l['room'], 'mode' => $l['mode'], 'note' => $l['note'],
    'debitPaise' => $paise($l['debit']), 'creditPaise' => $paise($l['credit']), 'balancePaise' => $paise($l['balance'])];

$out = [
    'source' => 'Pallav Support/CompanyLedger.php build/totals/period/modes and CompanyLedgerController::searchLines (verbatim); PHP '.PHP_VERSION,
    'companyId' => CO,
    'advances' => $advances,
    'bills' => $bills,
    'lines' => array_map($asJson, $lines),
    'totals' => array_map($paise, totals($lines)),
    'periods' => [],
    'searches' => [],
    'modes' => [],
];
foreach ([[null, null], ['2026-09-05', '2026-09-20'], ['2026-09-21', null], [null, '2026-09-04'], ['2026-11-01', '2026-11-30'], ['2026-09-05', '2026-09-05']] as [$from, $to]) {
    $p = period($lines, $from, $to);
    $out['periods'][] = ['from' => $from, 'to' => $to, 'openingPaise' => $paise($p['opening']), 'closingPaise' => $paise($p['closing']), 'count' => count($p['lines']), 'ids' => array_map(fn ($l) => $l['kind'].':'.$l['id'], $p['lines']),
        'totals' => array_map($paise, totals($p['lines']))];
}
foreach (['ravi', 'room 204', 'upi', 'payment', '1,500', '2000', '5500.50', '#2', '#0002', '0002', '2', '05-09-2026', '05/09/2026', '2026-09-05', '05 sep 2026', 'advance used', 'cheque', 'neha refund', 'xyz', '', 'bill 1190 card'] as $q) {
    $out['searches'][] = ['q' => $q, 'ids' => array_map(fn ($l) => $l['kind'].':'.$l['id'].':'.$l['order'], searchLines(array_map(fn ($l) => $l, $lines), $q))];
}
foreach ([['upi', 'UPI'], ['cash', null], ['CASH', 'cash'], ['  ', null], ['bank transfer', 'neft'], [null, null], ['Debit', 'debit']] as $pair) {
    $out['modes'][] = ['in' => $pair, 'out' => modes(...$pair)];
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
