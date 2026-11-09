<?php
// Golden fixtures for the Billing slice (Guest Advances), made by REAL PHP running Hotel Pallav's own code:
//   * BillMasterController::advanceAmounts / ::readable / ::held / ::advanceLabel   (called through Reflection on the real controller)
//   * BillMasterAdvance::isUnused / ::isRefunded                                    (the real model)
//   * the receipt number's year (BillMasterController.php:150: date('Y').' / '.$number) at IST year boundaries
//   * the refund and refund-reversal arithmetic, copied VERBATIM from BillMasterController.php:256-265 and :280-283 (it is inline in the
//     action methods, which need a whole request), with the result rounded to 2 places as the decimal(12,2) column stores it
//   * the entry number's zero padding (HasEntryNumber::entryNumber)
//
// Usage:  php db/scripts/php/generate-billing-fixtures.php <path to the Pallav repo> > db/scripts/php/fixtures/billing-advances.json
//         php db/scripts/php/generate-billing-fixtures.php <path to the Pallav repo> bills > db/scripts/php/fixtures/billing-bills.json
// The `bills` run covers BillMasterController::prepareBill (the totals and the stay priced by the REAL MealPlanRate::price, night by night,
// against a fixed rate table), and VERBATIM copies of the inline advance application (:433-444) and debit settlement (:525-539, :545-546).
// Needs only PHP 8.1+; no Laravel: the Eloquent Model (attributes only), the SoftDeletes trait and collect() are stubbed below, nothing else.
declare(strict_types=1);

namespace Illuminate\Database\Eloquent {
    trait SoftDeletes {}

    class Model
    {
        protected array $attributes = [];

        public function __construct(array $attributes = [])
        {
            $this->attributes = $attributes;
        }

        public function __get(string $key): mixed
        {
            return $this->attributes[$key] ?? null;
        }

        public function __set(string $key, mixed $value): void
        {
            $this->attributes[$key] = $value;
        }

        public function getAttributes(): array
        {
            return $this->attributes;
        }

        /** MealPlanRate::table() runs static::orderBy('effective_from')->get(): the rows come from $GLOBALS['RATES']. */
        public static function __callStatic(string $name, array $args): object
        {
            return new class {
                public function get(): \Illuminate\Support\Collection
                {
                    $rows = $GLOBALS['RATES'] ?? [];
                    usort($rows, fn ($a, $b) => strcmp($a[1], $b[1]));

                    return new \Illuminate\Support\Collection(array_map(fn ($r) => (object) ['plan' => $r[0], 'effective_from' => new \Illuminate\Support\Carbon($r[1]), 'rate_per_person' => $r[2]], $rows));
                }
            };
        }
    }
}

namespace Illuminate\Support {
    /** The few Carbon calls MealPlanRate::price and ::table make, over a mutable DateTime (Carbon is mutable too). */
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

        public function copy(): static
        {
            return new static($this->at->format('Y-m-d H:i:s'));
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
    }

    class Collection
    {
        public function __construct(private array $items) {}

        public function groupBy(callable $key): static
        {
            $out = [];
            foreach ($this->items as $item) {
                $out[$key($item)][] = $item;
            }

            return new static(array_map(fn ($group) => new static($group), $out));
        }

        public function map(callable $fn): static
        {
            return new static(array_map($fn, $this->items));
        }

        public function values(): static
        {
            return new static(array_values($this->items));
        }

        public function all(): array
        {
            return $this->items;
        }
    }
}

namespace Illuminate\Http {
    class Request
    {
        public function hasFile(string $key): bool
        {
            return false;
        }
    }
}

namespace {
    use App\Http\Controllers\BillMasterController;
    use App\Models\BillMasterAdvance;

    // collect(): only mapWithKeys and all are used by BillMasterController::readable
    function collect(array $items): object
    {
        return new class($items) {
            public function __construct(private array $items) {}

            public function mapWithKeys(callable $fn): static
            {
                $out = [];
                foreach ($this->items as $k => $v) {
                    foreach ($fn($v, $k) as $nk => $nv) {
                        $out[$nk] = $nv;
                    }
                }

                return new static($out);
            }

            public function all(): array
            {
                return $this->items;
            }
        };
    }

    $pallav = $argv[1] ?? null;
    if (! $pallav || ! is_file($pallav.'/app/Http/Controllers/BillMasterController.php')) {
        fwrite(STDERR, "Usage: php generate-billing-fixtures.php <path to the Pallav repo>\n");
        exit(1);
    }
    date_default_timezone_set('Asia/Kolkata');

    foreach (['app/Models/Concerns/Recyclable.php', 'app/Models/Concerns/InAccountingYear.php', 'app/Models/Concerns/HasEntryNumber.php',
        'app/Models/BillMasterAdvance.php', 'app/Http/Controllers/Controller.php', 'app/Http/Controllers/BillMasterController.php'] as $file) {
        require_once $pallav.'/'.$file;
    }

    if (($argv[2] ?? '') === 'bills') {
        require_once $pallav.'/app/Models/MealPlanRate.php';
    }
    $controller = new BillMasterController();
    $call = function (string $method, array $args) use ($controller) {
        $m = new ReflectionMethod(BillMasterController::class, $method);
        $m->setAccessible(true);

        return $m->invokeArgs($controller, $args);
    };
    // PHP floats as the JSON shows them: a whole number of paise, exactly as decimal(12,2) stores the value
    $paise = fn ($v) => $v === null ? null : (int) round(((float) $v) * 100);

    if (($argv[2] ?? '') === 'bills') {
        $paise = fn ($v) => $v === null ? null : (int) round(((float) $v) * 100);
        // the meal plan rates on the fixed table: CP changes mid-October, AP starts in May, EP has none; plan names are matched lower-cased
        $GLOBALS['RATES'] = [['CP', '2026-01-01', 250.00], ['CP', '2026-10-10', 275.00], ['MAP', '2026-01-01', 600.00], ['AP', '2026-05-01', 900.00], ['ep', '2026-01-01', 0.00]];
        $out = ['source' => 'Pallav BillMasterController::prepareBill, MealPlanRate::price (real), :433-444 and :525-546 (verbatim); PHP '.PHP_VERSION,
            'rates' => array_map(fn ($r) => ['plan' => $r[0], 'effectiveFrom' => $r[1], 'ratePaise' => $paise($r[2])], $GLOBALS['RATES'])];
        $segmentOut = fn ($s) => ['from' => $s['from'], 'to' => $s['to'], 'plan' => $s['plan'], 'persons' => $s['persons'], 'nights' => $s['nights'], 'ratePaise' => $paise($s['rate']), 'amountPaise' => $paise($s['amount'])];

        // ---- prepareBill: the two totals and the stay ------------------------------------------------------------------------------
        $lineCases = [
            ['hotel_amount' => '4000', 'hotel_plan_amount' => '500', 'hotel_extra_bed_amount' => '800', 'hotel_laundry_amount' => '150.50', 'hotel_other_amount' => '75', 'hotel_gst' => '660', 'food_amount' => '1200', 'food_plan_amount' => '0', 'food_laundry_amount' => '0', 'food_gst' => '60'],
            ['hotel_amount' => '0.10', 'hotel_gst' => '0.20', 'food_amount' => '0.30'],
            ['hotel_amount' => '-500', 'hotel_gst' => '-25', 'food_amount' => '100'],
            [],
            ['hotel_amount' => '99999999.99', 'food_gst' => '0.01'],
            ['hotel_amount' => '1234.56', 'hotel_plan_amount' => '7890.12', 'hotel_laundry_amount' => '3456.78', 'hotel_gst' => '0.34', 'food_amount' => '0.01', 'food_laundry_amount' => '0.02'],
        ];
        $stays = [
            [],
            [['from' => '2026-10-05', 'to' => '2026-10-08', 'plan' => 'CP', 'persons' => 2]],
            [['from' => '2026-10-08', 'to' => '2026-10-12', 'plan' => 'cp', 'persons' => 2]],
            [['from' => '2026-10-01', 'to' => '2026-10-03', 'plan' => 'MAP', 'persons' => 3], ['from' => '2026-10-03', 'to' => '2026-10-04', 'plan' => 'EP', 'persons' => 3]],
            [['from' => '2026-04-29', 'to' => '2026-05-02', 'plan' => 'AP', 'persons' => 1]],
            [['from' => '2026-10-05', 'to' => '2026-10-06', 'plan' => '', 'persons' => 4], ['from' => '', 'to' => '2026-10-06', 'plan' => 'CP', 'persons' => 1]],
            [['from' => '2025-12-30', 'to' => '2026-01-02', 'plan' => 'CP', 'persons' => 2]],
            [['from' => '2026-10-05', 'to' => '2026-10-06', 'plan' => 'Deluxe', 'persons' => 2]],
        ];
        $out['prepare'] = [];
        foreach ($lineCases as $i => $lines) {
            $stay = $stays[$i % count($stays)];
            $data = $lines + ['stay' => $stay];
            $args = [&$data, new \Illuminate\Http\Request()];
            [$hotelTotal, $foodTotal] = $call('prepareBill', $args);
            $out['prepare'][] = ['lines' => array_map($paise, $lines), 'stay' => $stay, 'hotelTotalPaise' => $paise($hotelTotal), 'foodTotalPaise' => $paise($foodTotal),
                'planFoodPaise' => $paise($data['plan_food_amount']), 'segments' => $data['stay_segments'] === null ? null : array_map($segmentOut, $data['stay_segments'])];
        }
        $out['stays'] = [];
        foreach ($stays as $stay) {
            $priced = \App\Models\MealPlanRate::price(array_values(array_filter($stay, fn ($p) => ! empty($p['from']) && ! empty($p['to']))));
            $out['stays'][] = ['stay' => $stay, 'totalPaise' => $paise($priced['total']), 'segments' => array_map($segmentOut, $priced['segments'])];
        }

        // ---- the advance taken off a new bill, and the debit balance: VERBATIM :433-444 --------------------------------------------
        $out['apply'] = [];
        foreach ([[5000, 0, 3000, 0, 'Cash', null], [5000, 0, 8000, 0, 'Debit', null], [2000, 1000, 1500, 2500, 'debit', 'Card'], [0, 1000, 500, 300, 'UPI', 'DEBIT'],
            [1000.50, 0, 1000.25, 0, 'Cash', null], [3000, 0, 0, 0, null, null], [10000, 2000, 4500.75, 1999.99, 'Debit', 'Debit']] as [$hb, $fb, $hotelTotal, $foodTotal, $hm, $fm]) {
            $advance = (object) ['hotel_balance' => $hb, 'food_balance' => $fb];
            $data = ['hotel_mode_of_payment' => $hm, 'food_mode_of_payment' => $fm];
            $data['advance_hotel_amount'] = min($advance->hotel_balance, $hotelTotal);
            $data['advance_food_amount'] = min($advance->food_balance, $foodTotal);
            $advance->hotel_balance = max(0, $advance->hotel_balance - $hotelTotal);
            $advance->food_balance = max(0, $advance->food_balance - $foodTotal);
            $data['balance_hotel_amount'] = strtolower((string) ($data['hotel_mode_of_payment'] ?? '')) === 'debit' ? $hotelTotal : 0;
            $data['balance_food_amount'] = strtolower((string) ($data['food_mode_of_payment'] ?? '')) === 'debit' ? $foodTotal : 0;
            $out['apply'][] = ['advanceHotelBalancePaise' => $paise($hb), 'advanceFoodBalancePaise' => $paise($fb), 'hotelTotalPaise' => $paise($hotelTotal), 'foodTotalPaise' => $paise($foodTotal),
                'hotelMode' => $hm, 'foodMode' => $fm, 'takenHotelPaise' => $paise($data['advance_hotel_amount']), 'takenFoodPaise' => $paise($data['advance_food_amount']),
                'leftHotelPaise' => $paise($advance->hotel_balance), 'leftFoodPaise' => $paise($advance->food_balance),
                'balanceHotelPaise' => $paise($data['balance_hotel_amount']), 'balanceFoodPaise' => $paise($data['balance_food_amount'])];
        }

        // ---- the debit settlement: VERBATIM :525-539 and :545-546 --------------------------------------------------------------------
        $out['settle'] = [];
        foreach ([
            [8000, 0, [[3000, 0], [5000, 0]]], [8000, 0, [[3000, 0]]], [8000, 0, [[9000, 0]]], [1500, 2500, [[1000, 1000], [500, 1000], [0, 600]]],
            [0, 0, [[700, 0]]], [1000.10, 0, [[999.80, 0]]], [5000, 5000, [[1000, 1000], [1000, 1000], [1000, 1000], [1000, 1000], [1000, 1500]]], [250.50, 0, [[0.50, 0], [250, 0]]],
            [100, 0, [[150.25, 0]]],
        ] as [$bh, $bf, $slots]) {
            $data = [];
            foreach ($slots as $i => [$h, $f]) {
                $suffix = $i === 0 ? '' : "_$i";
                $data["debit_hotel_amount{$suffix}"] = (string) $h;
                $data["debit_food_amount{$suffix}"] = (string) $f;
            }
            $bill = (object) ['balance_hotel_amount' => $bh, 'balance_food_amount' => $bf];
            $paidHotel = 0;
            $paidFood = 0;
            foreach (range(0, 4) as $i) {
                $suffix = $i === 0 ? '' : "_$i";
                $paidHotel += (float) ($data["debit_hotel_amount{$suffix}"] ?? 0);
                $paidFood += (float) ($data["debit_food_amount{$suffix}"] ?? 0);
            }
            $remainingHotel = $bill->balance_hotel_amount - $paidHotel;
            $remainingFood = $bill->balance_food_amount - $paidFood;
            $out['settle'][] = ['balanceHotelPaise' => $paise($bh), 'balanceFoodPaise' => $paise($bf), 'slots' => array_map(fn ($s) => [$paise($s[0]), $paise($s[1])], $slots),
                'debitHotelAdvance' => (string) max(0, -$remainingHotel), 'debitFoodAdvance' => (string) max(0, -$remainingFood),
                'leftHotelPaise' => $paise(max(0, $remainingHotel)), 'leftFoodPaise' => $paise(max(0, $remainingFood)),
                'excessHotelPaise' => $paise(max(0, -$remainingHotel)), 'excessFoodPaise' => $paise(max(0, -$remainingFood))];
        }
        $out['excessReceipt'] = 'Excessive / 2026 / 1188';

        echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
        exit(0);
    }

    $out = ['source' => 'Pallav app/Http/Controllers/BillMasterController.php, app/Models/BillMasterAdvance.php; PHP '.PHP_VERSION];

    // ---- advanceAmounts: the two sides, the balances, the total, the mode rule ------------------------------------------------------
    $sides = [
        [null, null], ['', ''], ['0', '0'], ['0.00', null], ['1000', null], [null, '500'], ['1000', '500'], ['1000.50', '0.50'],
        ['0.01', null], ['0.005', null], ['0.004', null], ['1234.565', '0.015'], ['99999999.99', '0.01'], ['0.1', '0.2'],
        ['-0', '0'], ['00012.30', null], ['1e3', null], ['2500', '0'], ['0', '750.25'],
    ];
    $out['advanceAmounts'] = [];
    foreach ($sides as [$h, $f]) {
        foreach ([['UPI', 'Cash'], [null, null]] as [$hm, $fm]) {
            $data = array_filter(['hotel_amount' => $h, 'food_amount' => $f, 'hotel_mode' => $hm, 'food_mode' => $fm], fn ($v) => $v !== null);
            $args = [&$data];
            $ok = $call('advanceAmounts', $args);
            $out['advanceAmounts'][] = [
                'input' => ['hotel_amount' => $h, 'food_amount' => $f, 'hotel_mode' => $hm, 'food_mode' => $fm],
                'ok' => $ok,
                'hotelPaise' => $paise($data['hotel_amount']), 'foodPaise' => $paise($data['food_amount']),
                'hotelBalancePaise' => $paise($data['hotel_balance']), 'foodBalancePaise' => $paise($data['food_balance']),
                'totalPaise' => $paise($data['total']),
                'hotelMode' => $data['hotel_mode'] ?? null, 'foodMode' => $data['food_mode'] ?? null,
            ];
        }
    }

    // ---- isUnused / isRefunded on stored decimals (MySQL hands decimals back as strings) ---------------------------------------------
    $states = [
        ['1000.00', '1000.00', '0.00', '0.00', null], ['1000.00', '999.99', '0.00', '0.00', null], ['1000.00', '1000.00', '500.00', '0.00', null],
        ['0.00', '0.00', '500.00', '500.00', null], ['1000.00', '0.00', '0.00', '0.00', null], ['1000.00', '1000.00', '0.00', '0.00', '2026-10-01'],
        ['1000.00', '400.00', '0.00', '0.00', '2026-10-01'], ['1000.50', '1000.5', '0', '0.00', null], ['0.10', '0.1', '0.20', '0.2', null],
    ];
    $out['states'] = [];
    foreach ($states as [$ha, $hb, $fa, $fb, $refund]) {
        $a = new BillMasterAdvance(['hotel_amount' => $ha, 'hotel_balance' => $hb, 'food_amount' => $fa, 'food_balance' => $fb,
            'refund_payment_date' => $refund === null ? null : new DateTimeImmutable($refund)]);
        $out['states'][] = ['hotelPaise' => $paise($ha), 'hotelBalancePaise' => $paise($hb), 'foodPaise' => $paise($fa), 'foodBalancePaise' => $paise($fb),
            'refunded' => $refund !== null, 'isUnused' => $a->isUnused(), 'isRefunded' => $a->isRefunded()];
    }

    // ---- refund arithmetic, VERBATIM from BillMasterController.php:256-265 ------------------------------------------------------------
    $refunds = [
        ['1000.00', '0.00', '400', null], ['1000.00', '0.00', '1000', null], ['1000.00', '0.00', '1000.01', null], ['1000.00', '500.00', '0', '0'],
        ['1000.00', '500.00', null, null], ['0.30', '0.00', '0.10', null], ['0.30', '0.00', '0.2', null], ['1000.10', '0.00', '0.30', null],
        ['500.00', '250.50', '500', '250.50'], ['500.00', '250.50', '0', '250.51'], ['99999999.99', '0.00', '0.01', null], ['0.00', '700.00', null, '700'],
    ];
    $out['refunds'] = [];
    foreach ($refunds as [$hBal, $fBal, $hRef, $fRef]) {
        $advance = (object) ['hotel_balance' => $hBal, 'food_balance' => $fBal];
        $data = array_filter(['hotel_refund_amount' => $hRef, 'food_refund_amount' => $fRef], fn ($v) => $v !== null);
        // :256-265
        $hotelRefund = $data['hotel_refund_amount'] ?? 0;
        $foodRefund = $data['food_refund_amount'] ?? 0;
        $refused = $hotelRefund > $advance->hotel_balance || $foodRefund > $advance->food_balance;
        $data['hotel_balance'] = $advance->hotel_balance - $hotelRefund;
        $data['food_balance'] = $advance->food_balance - $foodRefund;
        $data['total'] = $hotelRefund + $foodRefund;
        $out['refunds'][] = [
            'hotelBalancePaise' => $paise($hBal), 'foodBalancePaise' => $paise($fBal), 'hotelRefundPaise' => $paise($hRef), 'foodRefundPaise' => $paise($fRef),
            'refused' => $refused,
            'after' => $refused ? null : ['hotelBalancePaise' => $paise($data['hotel_balance']), 'foodBalancePaise' => $paise($data['food_balance']), 'totalPaise' => $paise($data['total'])],
        ];
    }

    // ---- refund reversal, VERBATIM from BillMasterController.php:280-283 --------------------------------------------------------------
    $out['reversals'] = [];
    foreach ([['600.00', '0.00', '400.00', null], ['0.00', '0.00', '1000.00', '500.00'], ['0.20', '0.00', '0.10', null], ['250.25', '100.00', null, null]] as [$hBal, $fBal, $hRef, $fRef]) {
        $advance = (object) ['hotel_balance' => $hBal, 'food_balance' => $fBal, 'hotel_refund_amount' => $hRef, 'food_refund_amount' => $fRef];
        $after = [
            'hotel_balance' => $advance->hotel_balance + $advance->hotel_refund_amount,
            'food_balance' => $advance->food_balance + $advance->food_refund_amount,
            'total' => ($advance->hotel_balance + $advance->hotel_refund_amount) + ($advance->food_balance + $advance->food_refund_amount),
        ];
        $out['reversals'][] = [
            'hotelBalancePaise' => $paise($hBal), 'foodBalancePaise' => $paise($fBal), 'hotelRefundPaise' => $paise($hRef), 'foodRefundPaise' => $paise($fRef),
            'after' => ['hotelBalancePaise' => $paise($after['hotel_balance']), 'foodBalancePaise' => $paise($after['food_balance']), 'totalPaise' => $paise($after['total'])],
        ];
    }

    // ---- the receipt number's year: date('Y') at the moment of saving, in IST ----------------------------------------------------------
    $out['receiptYears'] = [];
    foreach (['2026-12-31T18:29:59Z', '2026-12-31T18:30:00Z', '2027-01-01T00:00:00Z', '2026-06-15T10:00:00Z', '2027-12-31T18:30:00Z'] as $iso) {
        $ts = (new DateTimeImmutable($iso))->getTimestamp();
        foreach (['814', '1', ' 0042 ', 'A/7'] as $typed) {
            $out['receiptYears'][] = ['instant' => $iso, 'typed' => $typed, 'receipt' => date('Y', $ts).' / '.trim($typed)];
        }
    }

    // ---- the log: the label, readable field names, dates in held() ------------------------------------------------------------------
    $fields = ['receipt_number', 'guest_name', 'mobile_number', 'room_number', 'company_id', 'payment_date', 'hotel_amount', 'food_amount',
        'hotel_mode', 'food_mode', 'reference_name', 'reference_mobile_number', 'instruction', 'hotel_balance', 'food_balance', 'total',
        'hotel_refund_amount', 'food_refund_amount', 'hotel_refund_mode', 'food_refund_mode', 'refund_payment_date', 'refund_guest_name',
        'refund_mobile_number', 'refund_instruction', 'entry_no', 'deleted_by', 'updated_by', 'reservation_id'];
    $out['readable'] = $call('readable', [array_fill_keys($fields, 'x')]);

    $record = new BillMasterAdvance(['id' => 9, 'receipt_number' => '2026 / 814', 'guest_name' => 'Ravi Mehta', 'mobile_number' => '',
        'payment_date' => new DateTimeImmutable('2026-10-05'), 'refund_payment_date' => null, 'hotel_amount' => '1000.00', 'food_amount' => '0.00',
        'hotel_mode' => 'UPI', 'food_mode' => null, 'total' => '1000.00', 'entry_no' => 7, 'created_at' => 'x', 'updated_at' => 'x', 'created_by' => 3]);
    $out['label'] = $call('advanceLabel', [$record]);
    $out['whole'] = $call('whole', [$record]);
    $out['heldKeepEmpty'] = $call('held', [$record, ['guest_name', 'mobile_number', 'payment_date', 'refund_payment_date'], true]);

    // ---- entry numbers --------------------------------------------------------------------------------------------------------------
    $out['entryNumbers'] = array_map(fn ($n) => ['n' => $n, 'text' => str_pad((string) $n, 4, '0', STR_PAD_LEFT)], [1, 9, 10, 999, 1000, 9999, 10000]);

    echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
}
