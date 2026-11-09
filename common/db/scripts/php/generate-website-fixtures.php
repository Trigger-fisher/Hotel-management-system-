<?php
// Golden fixtures for the Website's availability, made by REAL PHP running VERBATIM copies of Pallav's Support/Site/Availability.php:
// stayNights (:22-39), the per-night state of room() (:72-143) with its three reads replaced by the rows they would return,
// freeForStay (:146-150), unavailableNight (:160-179), blockedRanges (:187-215) and the calendar's save rules (CalendarController::saveInventory
// :97-121). Eloquent is replaced by plain arrays; Carbon::today()->addMonthsNoOverflow(3) by the same clamp written out.
//
// Usage:  php db/scripts/php/generate-website-fixtures.php > db/scripts/php/fixtures/website.json
declare(strict_types=1);

date_default_timezone_set('Asia/Kolkata');
mt_srand(20261009);

const MAX_STAY_NIGHTS = 60;
const OPEN_WINDOW_MONTHS = 3;

function stayNights(?string $checkIn, ?string $checkOut): array
{
    if (! $checkIn || ! $checkOut) {
        return [];
    }
    $start = strtotime($checkIn);
    $end = strtotime($checkOut);
    if (! $start || ! $end || $end <= $start || ($end - $start) > MAX_STAY_NIGHTS * 86400) {
        return [];
    }
    $nights = [];
    for ($cursor = $start; $cursor < $end; $cursor = strtotime('+1 day', $cursor)) {
        $nights[] = date('Y-m-d', $cursor);
    }

    return $nights;
}

/** Carbon::addMonthsNoOverflow: the same day of the month N months on, clamped to that month's last day. */
function addMonthsNoOverflow(string $day, int $months): string
{
    $d = new DateTimeImmutable($day);
    $first = $d->modify('first day of this month')->modify("+{$months} months");
    $last = (int) $first->format('t');

    return $first->setDate((int) $first->format('Y'), (int) $first->format('n'), min((int) $d->format('j'), $last))->format('Y-m-d');
}

/** room(): $overrides [date => [rooms_left, blocked]], $stays [[check_in, check_out]], $held [night => count] (FrontDesk::held without website ones). */
function room(string $today, int $defaultCapacity, array $overrides, array $stays, array $held, array $nights, bool $respectOpenWindow = true): array
{
    if (! $nights) {
        return [];
    }
    $openThrough = addMonthsNoOverflow($today, OPEN_WINDOW_MONTHS);
    $to = $nights[count($nights) - 1];
    $from = $nights[0];
    $sold = array_fill_keys($nights, 0);
    foreach ($stays as [$in, $out]) {
        if (! ($in <= $to && $out > $from)) {
            continue;
        }
        foreach (stayNights($in, $out) as $night) {
            if (isset($sold[$night])) {
                $sold[$night]++;
            }
        }
    }
    foreach ($held as $night => $count) {
        if (isset($sold[$night])) {
            $sold[$night] += $count;
        }
    }
    $out = [];
    foreach ($nights as $night) {
        $override = $overrides[$night] ?? null;
        if ($override) {
            $blocked = (bool) $override[1];
            $capacity = (int) $override[0];
        } else {
            $blocked = $respectOpenWindow && $night > $openThrough;
            $capacity = $blocked ? 0 : $defaultCapacity;
        }
        if ($blocked) {
            $capacity = 0;
        }
        $out[$night] = ['capacity' => $capacity, 'sold' => $sold[$night], 'free' => max(0, $capacity - $sold[$night]), 'blocked' => $blocked];
    }

    return $out;
}

function blockedRanges(array $rows, string $today): array
{
    // $rows [room_id, date, room_name] already ordered by room then date; only today-1 on
    $floor = date('Y-m-d', strtotime($today.' -1 day'));
    $rows = array_values(array_filter($rows, fn ($r) => $r[1] >= $floor));
    $ranges = [];
    $current = null;
    foreach ($rows as [$roomId, $date, $roomName]) {
        $continues = $current && $current['room_id'] === $roomId && $date === date('Y-m-d', strtotime($current['end'].' +1 day'));
        if ($continues) {
            $current['end'] = $date;
            continue;
        }
        if ($current) {
            $ranges[] = $current;
        }
        $current = ['room_id' => $roomId, 'room_name' => $roomName, 'start' => $date, 'end' => $date];
    }
    if ($current) {
        $ranges[] = $current;
    }

    return $ranges;
}

/** saveInventory's two refusals (:106-113). */
function inventoryRule(int $left, int $sold, int $total, string $name): ?string
{
    if ($left < $sold) {
        return "Can't go below {$sold} - {$sold} ".($sold === 1 ? 'room is' : 'rooms are').' already confirmed for this date.';
    }
    if ($left > $total) {
        return "Can't go above {$total} - that's the total number of {$name} rooms.";
    }

    return null;
}

$cases = [];
$today = '2026-10-05';
$day = fn (int $offset, string $from = '2026-10-05') => date('Y-m-d', strtotime($from.' '.($offset >= 0 ? '+' : '').$offset.' days'));

// hand-made
$cases[] = ['name' => 'a quiet week, 5 rooms, nothing set', 'today' => $today, 'capacity' => 5, 'overrides' => [], 'stays' => [], 'held' => [], 'checkIn' => '2026-10-06', 'checkOut' => '2026-10-09', 'respect' => true];
$cases[] = ['name' => 'confirmed stays overlap the range (half-open nights)', 'today' => $today, 'capacity' => 3, 'overrides' => [], 'stays' => [['2026-10-06', '2026-10-08'], ['2026-10-07', '2026-10-10'], ['2026-10-01', '2026-10-06']], 'held' => ['2026-10-08' => 1], 'checkIn' => '2026-10-05', 'checkOut' => '2026-10-11', 'respect' => true];
$cases[] = ['name' => 'an override sets the rooms and a block closes a night', 'today' => $today, 'capacity' => 4, 'overrides' => ['2026-10-07' => [2, 0], '2026-10-08' => [3, 1]], 'stays' => [['2026-10-07', '2026-10-08']], 'held' => [], 'checkIn' => '2026-10-06', 'checkOut' => '2026-10-10', 'respect' => true];
$cases[] = ['name' => 'beyond the open window the night is closed with nothing set', 'today' => $today, 'capacity' => 4, 'overrides' => ['2027-01-07' => [4, 0]], 'stays' => [], 'held' => [], 'checkIn' => '2027-01-04', 'checkOut' => '2027-01-09', 'respect' => true];
$cases[] = ['name' => 'the same stay when deciding on a real request (no window)', 'today' => $today, 'capacity' => 4, 'overrides' => [], 'stays' => [], 'held' => [], 'checkIn' => '2027-01-04', 'checkOut' => '2027-01-09', 'respect' => false];
$cases[] = ['name' => 'the window edge: today 30 Nov, 3 months on is 28 Feb', 'today' => '2026-11-30', 'capacity' => 2, 'overrides' => [], 'stays' => [], 'held' => [], 'checkIn' => '2027-02-26', 'checkOut' => '2027-03-03', 'respect' => true];
$cases[] = ['name' => 'leap year window edge: today 30 Nov 2023', 'today' => '2023-11-30', 'capacity' => 2, 'overrides' => [], 'stays' => [], 'held' => [], 'checkIn' => '2024-02-27', 'checkOut' => '2024-03-02', 'respect' => true];
$cases[] = ['name' => 'a stay longer than 60 nights has no nights', 'today' => $today, 'capacity' => 2, 'overrides' => [], 'stays' => [], 'held' => [], 'checkIn' => '2026-10-06', 'checkOut' => '2026-12-20', 'respect' => true];
$cases[] = ['name' => 'check-out on check-in has no nights', 'today' => $today, 'capacity' => 2, 'overrides' => [], 'stays' => [], 'held' => [], 'checkIn' => '2026-10-06', 'checkOut' => '2026-10-06', 'respect' => true];
$cases[] = ['name' => 'exactly 60 nights', 'today' => $today, 'capacity' => 6, 'overrides' => [], 'stays' => [['2026-10-10', '2026-10-12']], 'held' => [], 'checkIn' => '2026-10-06', 'checkOut' => '2026-12-05', 'respect' => false];
for ($n = 0; $n < 90; $n++) {
    $t = $day(mt_rand(-10, 200));
    $in = $day(mt_rand(-3, 150), $t);
    $out = $day(mt_rand(-1, 14), $in);
    $stays = [];
    for ($i = mt_rand(0, 4); $i > 0; $i--) {
        $a = $day(mt_rand(-5, 20), $in);
        $stays[] = [$a, $day(mt_rand(1, 6), $a)];
    }
    $ov = [];
    for ($i = mt_rand(0, 4); $i > 0; $i--) {
        $ov[$day(mt_rand(-1, 12), $in)] = [mt_rand(0, 6), mt_rand(0, 3) === 0 ? 1 : 0];
    }
    $held = [];
    for ($i = mt_rand(0, 3); $i > 0; $i--) {
        $held[$day(mt_rand(0, 10), $in)] = mt_rand(1, 3);
    }
    $cases[] = ['name' => 'generated '.$n, 'today' => $t, 'capacity' => mt_rand(0, 8), 'overrides' => $ov, 'stays' => $stays, 'held' => $held, 'checkIn' => $in, 'checkOut' => $out, 'respect' => mt_rand(0, 1) === 1];
}
$rows = [];
foreach ($cases as $c) {
    $nights = stayNights($c['checkIn'], $c['checkOut']);
    $state = room($c['today'], $c['capacity'], $c['overrides'], $c['stays'], $c['held'], $nights, $c['respect']);
    // unavailableNight uses the stay's room with the window off and the enquiry itself ignored (already left out of $stays by the caller)
    $stateNoWindow = room($c['today'], $c['capacity'], $c['overrides'], $c['stays'], $c['held'], $nights, false);
    $unavailable = null;
    foreach ($stateNoWindow as $night => $s) {
        if ($s['free'] < 1) {
            $unavailable = $night;
            break;
        }
    }
    $rows[] = $c + ['nights' => $nights, 'state' => $state, 'freeForStay' => $state ? min(array_column($state, 'free')) : 0, 'unavailableNight' => $unavailable];
}

$blocked = [];
$blocked[] = ['name' => 'a week closed is one row; another room is its own', 'today' => '2026-10-05', 'rows' => [['r1', '2026-10-06', 'Deluxe'], ['r1', '2026-10-07', 'Deluxe'], ['r1', '2026-10-08', 'Deluxe'], ['r1', '2026-10-12', 'Deluxe'], ['r2', '2026-10-07', 'Standard'], ['r2', '2026-10-08', 'Standard']]];
$blocked[] = ['name' => 'yesterday still shows, the day before does not', 'today' => '2026-10-05', 'rows' => [['r1', '2026-10-03', 'Deluxe'], ['r1', '2026-10-04', 'Deluxe'], ['r1', '2026-10-05', 'Deluxe']]];
$blocked[] = ['name' => 'month and year ends', 'today' => '2026-12-20', 'rows' => [['r1', '2026-12-30', 'Deluxe'], ['r1', '2026-12-31', 'Deluxe'], ['r1', '2027-01-01', 'Deluxe'], ['r1', '2027-02-28', 'Deluxe'], ['r1', '2027-03-01', 'Deluxe']]];
foreach ($blocked as &$b) {
    $b['ranges'] = blockedRanges($b['rows'], $b['today']);
}
unset($b);

$rules = [];
foreach ([[0, 0, 5, 'Deluxe'], [1, 2, 5, 'Deluxe'], [3, 2, 5, 'Deluxe'], [6, 1, 5, 'Deluxe'], [5, 1, 5, 'Deluxe'], [2, 1, 2, 'Standard'], [4, 0, 3, 'Suite'], [3, 3, 2, 'Suite']] as [$left, $sold, $total, $name]) {
    $rules[] = ['left' => $left, 'sold' => $sold, 'total' => $total, 'name' => $name, 'message' => inventoryRule($left, $sold, $total, $name)];
}


// ---- Support/Site/Phone.php normalize (:35-60) and display (:63-73), guests (:80-95) -------------------------------------------------------------
const CALLING_CODES = [
    '971', '972', '973', '974', '966', '968', '965', '962', '961', '963', '964',
    '880', '977', '960', '976', '975', '673',
    '86', '81', '82', '84', '65', '60', '66', '63', '62', '91', '92', '93', '94', '95', '98',
    '44', '49', '33', '39', '34', '31', '32', '41', '43', '46', '47', '45', '48', '30', '36', '61', '64', '20', '27', '55', '52', '54', '51', '57', '58',
    '1', '7',
];
function phoneNormalize(string $raw): string
{
    $raw = trim($raw);
    $hasPlus = isset($raw[0]) && $raw[0] === '+';
    $digits = preg_replace('/\D/', '', $raw);
    if (! $hasPlus && strlen($digits) === 10) {
        $digits = '91'.$digits;
    } elseif ($hasPlus) {
        foreach (CALLING_CODES as $code) {
            $len = strlen($code);
            if (substr($digits, 0, $len) === $code && substr($digits, $len, 1) === '0') {
                $digits = $code.substr($digits, $len + 1);
                break;
            }
        }
    }

    return '+'.$digits;
}
function phoneDisplay(?string $raw): string
{
    $digits = preg_replace('/\D/', '', $raw ?? '');
    if (strlen($digits) === 12 && str_starts_with($digits, '91')) {
        return '+91 '.substr($digits, 2, 5).' '.substr($digits, 7, 5);
    }
    if (strlen($digits) === 10) {
        return '+91 '.substr($digits, 0, 5).' '.substr($digits, 5, 5);
    }

    return $raw ?? '';
}
function guestsLabel(?int $total, ?int $children): string
{
    $total = (int) $total;
    $children = (int) $children;
    if ($total <= 0) {
        return '';
    }
    if ($children <= 0) {
        return $total.' Guest'.($total === 1 ? '' : 's');
    }
    $adults = max(0, $total - $children);

    return $adults.' Guest'.($adults === 1 ? '' : 's').' + '.$children.' Child'.($children === 1 ? '' : 'ren');
}
/** Reference::next's fiscal year and string (:12-37), the counter value given. */
function reference(string $date, int $serial): array
{
    $month = (int) date('n', strtotime($date));
    $year = (int) date('Y', strtotime($date));
    $fiscalYear = $month >= 4 ? $year : $year - 1;

    return ['fiscalYear' => $fiscalYear, 'reference' => 'HP-'.date('dmY', strtotime($date)).'-'.str_pad((string) $serial, 5, '0', STR_PAD_LEFT)];
}
$phoneInputs = ['9825735404', '+91 98257 35404', '098257 35404', '+44 07574650997', '+44 7574650997', '+971 050 123 4567', '0091 98257 35404', '919825735404', '+919825735404', '+1 (201) 555-0123',
    '', ' ', 'abc', '+', '12345', '98257-35404', '+7 0912 345 6789', '+91 0 98257 35404', '+880 01712345678', '+999 0123', '  +65 06123 4567  ', '+1 0201 555 0123'];
for ($n = 0; $n < 150; $n++) {
    $len = mt_rand(5, 14);
    $d = '';
    for ($i = 0; $i < $len; $i++) {
        $d .= (string) mt_rand(0, 9);
    }
    $phoneInputs[] = (mt_rand(0, 1) ? '+' : '').(mt_rand(0, 3) === 0 ? CALLING_CODES[mt_rand(0, count(CALLING_CODES) - 1)].'0' : '').$d;
}
$phones = array_map(fn ($raw) => ['raw' => $raw, 'normalized' => phoneNormalize($raw), 'display' => phoneDisplay(phoneNormalize($raw)), 'displayRaw' => phoneDisplay($raw)], $phoneInputs);
$guests = [];
foreach ([[0, 0], [1, 0], [2, 0], [3, 1], [3, 0], [2, 2], [1, 1], [4, 3], [5, 6], [-1, 0], [1, null]] as [$total, $children]) {
    $guests[] = ['total' => $total, 'children' => $children, 'label' => guestsLabel($total, $children)];
}
$references = [];
foreach (['2026-10-05', '2027-03-31', '2027-04-01', '2026-04-01', '2026-03-31', '2026-12-31', '2028-02-29'] as $d) {
    foreach ([1, 42, 99999, 123456] as $serial) {
        $references[] = ['date' => $d, 'serial' => $serial] + reference($d, $serial);
    }
}

echo json_encode(['php' => PHP_VERSION, 'phones' => $phones, 'guests' => $guests, 'references' => $references, 'cases' => $rows, 'blocked' => $blocked, 'rules' => $rules, 'windows' => [
    ['2026-10-05', addMonthsNoOverflow('2026-10-05', 3)], ['2026-11-30', addMonthsNoOverflow('2026-11-30', 3)], ['2023-11-30', addMonthsNoOverflow('2023-11-30', 3)], ['2026-05-31', addMonthsNoOverflow('2026-05-31', 3)], ['2026-12-31', addMonthsNoOverflow('2026-12-31', 3)],
]], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
