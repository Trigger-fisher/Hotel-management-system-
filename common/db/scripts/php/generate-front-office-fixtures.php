<?php
// Golden fixtures for the Front Office slice, made by REAL PHP:
//   * FrontDesk::nights (the real function: the nights from check-in up to, not including, check-out, at most 366)
//   * Stay::nights / ::roomCharge, the charge amount (StayController.php:159), the check-out bill's GST and totals (Support/Pms/Billing.php:78-88),
//     the mobile number on a bill (:95), the address (:98), the reservation reference (Reservation.php:45), the website-enquiry rate
//     (FrontDesk.php:159-171) and the occupancy figure (BoardController.php:149): VERBATIM copies of Pallav's expressions (they sit inside
//     models and actions that need a database), evaluated by PHP itself with PHP's floats and round().
//
// Usage:  php db/scripts/php/generate-front-office-fixtures.php <path to the Pallav repo> > db/scripts/php/fixtures/front-office.json
// Needs only PHP 8.1+; the few Carbon calls FrontDesk::nights makes are stubbed.
declare(strict_types=1);

namespace Illuminate\Support {
    class Carbon
    {
        private \DateTime $at;

        public function __construct(string $at = 'now')
        {
            $this->at = new \DateTime($at);
        }

        public static function parse(string $at): static
        {
            return new static($at);
        }

        public function startOfDay(): static
        {
            $this->at->setTime(0, 0, 0);

            return $this;
        }

        public function lt(self $other): bool
        {
            return $this->at < $other->at;
        }

        public function addDay(): static
        {
            $this->at->modify('+1 day');

            return $this;
        }

        public function toDateString(): string
        {
            return $this->at->format('Y-m-d');
        }

        /** Carbon 3 (Laravel 11): a float number of days, whole here because both ends are at the start of a day. */
        public function diffInDays(self $other): float
        {
            return (float) (($other->at->getTimestamp() - $this->at->getTimestamp()) / 86400);
        }
    }

    class Collection {}
}

namespace Illuminate\Support\Facades {
    class Schema {}
}

namespace {
    use App\Support\Pms\FrontDesk;
    use Illuminate\Support\Carbon;

    $pallav = $argv[1] ?? null;
    if (! $pallav || ! is_file($pallav.'/app/Support/Pms/FrontDesk.php')) {
        fwrite(STDERR, "Usage: php generate-front-office-fixtures.php <path to the Pallav repo>\n");
        exit(1);
    }
    date_default_timezone_set('Asia/Kolkata');
    require_once $pallav.'/app/Support/Pms/FrontDesk.php';
    $paise = fn ($v) => $v === null ? null : (int) round(((float) $v) * 100);
    $out = ['source' => 'Pallav Support/Pms/FrontDesk.php (real), Stay.php, StayController.php, Support/Pms/Billing.php, Reservation.php, BoardController.php (verbatim); PHP '.PHP_VERSION];

    // ---- FrontDesk::nights (real) ---------------------------------------------------------------------------------------------------
    $out['nights'] = [];
    foreach ([['2026-10-05', '2026-10-08'], ['2026-10-05', '2026-10-05'], ['2026-10-08', '2026-10-05'], ['2026-02-27', '2026-03-02'], ['2028-02-28', '2028-03-01'],
        ['2026-12-30', '2027-01-02'], ['2026-01-01', '2027-06-01']] as [$from, $to]) {
        $nights = FrontDesk::nights($from, $to);
        $out['nights'][] = ['from' => $from, 'to' => $to, 'count' => count($nights), 'first' => $nights[0] ?? null, 'last' => $nights ? end($nights) : null];
    }

    // ---- Stay::nights and ::roomCharge (Stay.php:59-69), VERBATIM ------------------------------------------------------------------
    $out['roomCharges'] = [];
    foreach ([['2026-10-05 14:30:00', '2026-10-08 11:00:00', '2500'], ['2026-10-05 14:30:00', '2026-10-05 20:00:00', '2500'], ['2026-10-05 01:10:00', '2026-10-06 10:00:00', '1999.99'],
        ['2026-10-05 23:59:00', '2026-10-06 00:01:00', '3333.33'], ['2026-10-01 12:00:00', '2026-10-31 12:00:00', '1234.567'], ['2026-03-31 18:00:00', '2026-04-02 09:00:00', '0'],
        ['2026-10-05 12:00:00', '2026-10-12 12:00:00', '0.01']] as [$in, $outAt, $rate]) {
        $end = Carbon::parse($outAt)->startOfDay();
        $nights = max(1, (int) Carbon::parse($in)->startOfDay()->diffInDays($end));
        $out['roomCharges'][] = ['checkInAt' => $in, 'until' => $outAt, 'rate' => $rate, 'nights' => $nights, 'roomPaise' => $paise(round($nights * (float) $rate, 2))];
    }

    // ---- the charge amount (StayController.php:159), VERBATIM -----------------------------------------------------------------------
    $out['charges'] = [];
    foreach ([['1', '250'], ['2', '125.50'], ['1.5', '333.33'], ['0.01', '9999999'], ['3.33', '3.33'], ['9999', '0.01'], ['0.5', '0.05'], ['2.25', '0.35'], ['1.15', '1.15']] as [$q, $u]) {
        $out['charges'][] = ['quantity' => $q, 'unitPricePaise' => $paise($u), 'amountPaise' => $paise(round((float) $q * (float) $u, 2))];
    }

    // ---- the check-out bill (Billing.php:78-88), VERBATIM ---------------------------------------------------------------------------
    $out['checkout'] = [];
    foreach ([
        [7500, 0, 150.50, 0, 1200, 5, 5], [7500, 500, 150.50, 75, 1200, 12, 18], [2499.99, 0, 0, 0, 0, 5, 5], [0, 0, 0, 0, 333.33, 0, 5], [10000, 0, 0, 0, 0, 28, 0],
        [1234.56, 78.9, 0.01, 0, 99.99, 2.5, 7.5], [3333.33, 0, 0, 0, 666.67, 18, 18], [0.1, 0.2, 0, 0, 0.3, 5, 5],
    ] as [$room, $extraBed, $laundry, $other, $food, $hp, $fp]) {
        $data = ['hotel_gst_percent' => $hp, 'food_gst_percent' => $fp];
        $hotelGst = round(($room + $extraBed + $laundry + $other) * (float) ($data['hotel_gst_percent'] ?? 0) / 100, 2);
        $foodGst = round($food * (float) ($data['food_gst_percent'] ?? 0) / 100, 2);
        $hotelTotal = round($room + $extraBed + $laundry + $other + $hotelGst, 2);
        $foodTotal = round($food + $foodGst, 2);
        $out['checkout'][] = ['roomPaise' => $paise($room), 'extraBedPaise' => $paise($extraBed), 'laundryPaise' => $paise($laundry), 'otherPaise' => $paise($other), 'foodPaise' => $paise($food),
            'hotelGstPercent' => (string) $hp, 'foodGstPercent' => (string) $fp,
            'hotelGstPaise' => $paise($hotelGst), 'foodGstPaise' => $paise($foodGst), 'hotelTotalPaise' => $paise($hotelTotal), 'foodTotalPaise' => $paise($foodTotal)];
    }

    // ---- small texts: mobile on a bill (:95), address (:98), reservation reference (Reservation.php:45), VERBATIM -------------------
    $out['mobiles'] = array_map(fn ($m) => ['in' => $m, 'out' => $m ? mb_substr(preg_replace('/[^0-9+]/', '', $m), 0, 15) : null],
        ['+91 98765 43210', '098765-43210', '(0281) 245 6789 ext 12', 'call me', '', '+1 (555) 010-9999 x123456', '९८७६५४३२१०']);
    $out['addresses'] = array_map(fn ($p) => ['address' => $p[0], 'city' => $p[1], 'out' => implode(', ', array_filter([$p[0], $p[1]])) ?: null],
        [['150 Ring Road', 'Rajkot'], ['150 Ring Road', null], [null, 'Rajkot'], [null, null], ['', 'Rajkot'], ['0', 'Rajkot']]);
    $out['references'] = [];
    foreach ([['2026-10-05 10:00:00', 1], ['2026-10-05 10:00:00', 42], ['2027-01-01 00:00:00', 99999], ['2026-12-31 23:59:59', 100000]] as [$at, $id]) {
        $out['references'][] = ['at' => $at, 'n' => $id, 'reference' => 'RES-'.date('y', strtotime($at)).'-'.str_pad((string) $id, 5, '0', STR_PAD_LEFT)];
    }

    // ---- the website enquiry's rate (FrontDesk.php:159-171), VERBATIM -------------------------------------------------------------
    $out['enquiryRates'] = [];
    foreach ([[2, 0, 4000, 3200], [1, 0, 4000, 3200], [1, 0, 4000, null], [3, 2, 4000, 3200], [2, 1, 4000, 3200], [0, 0, 4000, 3200], [null, null, 4000, 3200], [2, 3, 4000, 3200]] as [$g, $c, $double, $single]) {
        $guests = max(1, (int) $g);
        $children = (int) $c;
        $plan = (object) ['price_double' => $double, 'price_single' => $single];
        $rate = $plan ? ($guests - $children <= 1 && $plan->price_single ? $plan->price_single : $plan->price_double) : 0;
        $out['enquiryRates'][] = ['guests' => $g, 'children' => $c, 'doublePaise' => $paise($double), 'singlePaise' => $paise($single), 'ratePaise' => $paise($rate), 'adults' => max(1, $guests - $children)];
    }

    // ---- occupancy on the board (BoardController.php:149), VERBATIM -----------------------------------------------------------------
    $out['occupancy'] = [];
    foreach ([[0, 0], [1, 3], [2, 3], [1, 8], [5, 8], [7, 8], [12, 40], [1, 200]] as [$occupied, $inService]) {
        $out['occupancy'][] = ['occupied' => $occupied, 'inService' => $inService, 'percent' => $inService ? (int) round($occupied * 100 / $inService) : 0];
    }

    echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
}
