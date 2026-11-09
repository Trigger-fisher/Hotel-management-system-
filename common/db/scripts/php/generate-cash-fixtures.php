<?php
// Golden fixtures for the Daily Cash revenue slice, made by REAL PHP running Hotel Pallav's own functions:
//   * App\Support\NumberToWords::convert         (amount in words)
//   * App\Support\CashLedger::search / ::stamp   (the list search, the date/time stamp)
//   * the entry number's zero padding (HasEntryNumber::entryNumber is str_pad(..., 4, '0', STR_PAD_LEFT))
//   * today / this month in IST (plain PHP DateTime: Carbon's startOfMonth/endOfMonth/toDateString give the same dates)
//
// Usage:  php db/scripts/php/generate-cash-fixtures.php <path to the Pallav repo> > "web-app/tests/server/fixtures/cash-revenue.json"
// Needs only PHP 8.1+; no Laravel is installed: the few Laravel classes the Pallav functions touch are stubbed below (a Collection with
// filter/values, and the now() helper), nothing else.
declare(strict_types=1);

namespace Illuminate\Support {
    class Collection
    {
        public function __construct(private array $items) {}

        public function filter(callable $fn): static
        {
            return new static(array_filter($this->items, $fn));
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

namespace App\Models {
    class User {}
}

namespace Illuminate\Pagination {
    class LengthAwarePaginator {}
}

namespace Illuminate\Database\Eloquent {
    class Model {}
}

namespace {
    use App\Support\CashLedger;
    use App\Support\NumberToWords;
    use Illuminate\Support\Collection;

    $pallav = $argv[1] ?? null;
    if (! $pallav || ! is_file($pallav.'/app/Support/NumberToWords.php')) {
        fwrite(STDERR, "Usage: php generate-cash-fixtures.php <path to the Pallav repo>\n");
        exit(1);
    }
    date_default_timezone_set('Asia/Kolkata');

    // now(): fixed per case, with the two methods CashLedger::stamp calls
    $GLOBALS['NOW'] = new DateTimeImmutable('2026-10-05 12:00:00');
    function now(): object
    {
        return new class($GLOBALS['NOW']) {
            public function __construct(private DateTimeImmutable $at) {}

            public function toDateString(): string
            {
                return $this->at->format('Y-m-d');
            }

            public function format(string $f): string
            {
                return $this->at->format($f);
            }
        };
    }

    require_once $pallav.'/app/Support/NumberToWords.php';
    require_once $pallav.'/app/Support/CashLedger.php';

    $out = ['source' => 'Pallav app/Support/NumberToWords.php, app/Support/CashLedger.php; PHP '.PHP_VERSION];

    // ---- amount in words -------------------------------------------------------------------------------------------
    mt_srand(2026);
    $paise = [0, 1, 5, 10, 11, 19, 20, 21, 50, 99, 100, 101, 105, 110, 111, 119, 120, 199, 200, 999, 1000, 1001, 1050, 1099, 1100, 1999,
        2000, 9999, 10000, 10001, 10050, 99999, 100000, 100001, 100100, 110000, 111100, 150000, 199999, 250050, 999999, 1000000, 1234567,
        9999999, 10000000, 10000001, 12345600, 123456789, 999999999, 1000000000, 1000000001, 1234567890, 9999999999, 10000000000,
        10000000001, 12345678901, 99999999999, 100000000000, 100000000001, 100000000050, 100000000100, 123456789012, 999999999999];
    foreach ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as $digits) {
        for ($i = 0; $i < 24; $i++) {
            $paise[] = mt_rand(10 ** ($digits - 1), 10 ** $digits - 1);
        }
    }
    $paise = array_values(array_unique($paise));
    sort($paise);
    $out['words'] = array_map(fn ($p) => ['paise' => $p, 'words' => NumberToWords::convert($p / 100)], $paise);

    // ---- entry numbers ----------------------------------------------------------------------------------------------
    $out['entryNumbers'] = array_map(fn ($n) => ['n' => $n, 'text' => str_pad((string) $n, 4, '0', STR_PAD_LEFT)], [0, 1, 9, 10, 99, 100, 999, 1000, 9999, 10000, 123456]);

    // ---- the list search --------------------------------------------------------------------------------------------
    class Person
    {
        public function __construct(private string $name) {}

        public function displayName(): string
        {
            return $this->name;
        }
    }

    class Row
    {
        public function __construct(public array $a) {}

        public function __get($k)
        {
            return $this->a[$k] ?? null;
        }

        public function entryNumber(): string
        {
            return str_pad((string) $this->a['entry_no'], 4, '0', STR_PAD_LEFT);
        }
    }

    $rowsData = [
        ['entry_no' => 1, 'book' => 'hotel', 'date' => '2026-10-01', 'time' => '09:15:00', 'depositor' => 'Ashok Desai (Manager)', 'reason' => 'Walk-in guests, 3 rooms', 'full_name' => 'Asha', 'user' => 'Asha Patel', 'amount' => 24000.00],
        ['entry_no' => 2, 'book' => 'hotel', 'date' => '2026-10-01', 'time' => '18:40:30', 'depositor' => 'Bank deposit (HDFC Rajkot)', 'reason' => null, 'full_name' => 'Kiran', 'user' => 'Kiran Shah (deleted)', 'amount' => 1500.50],
        ['entry_no' => 3, 'book' => 'food', 'date' => '2026-10-02', 'time' => '12:00:00', 'depositor' => 'Hitesh Parmar (Chef)', 'reason' => 'Lunch counter, cash only', 'full_name' => 'Asha', 'user' => 'Asha Patel', 'amount' => 5000.00],
        ['entry_no' => 4, 'book' => 'food', 'date' => '2026-10-03', 'time' => '23:59:59', 'depositor' => 'Mihir Jungiwala (Owner)', 'reason' => '50% advance; "special" order', 'full_name' => 'Mihir', 'user' => 'Mihir Jungiwala', 'amount' => 125000.00],
        ['entry_no' => 5, 'book' => 'hotel', 'date' => '2026-10-04', 'time' => '00:00:00', 'depositor' => 'Suresh Vaghela', 'reason' => 'o\'brien & sons', 'full_name' => 'Asha', 'user' => 'Asha Patel', 'amount' => 0.05],
        ['entry_no' => 6, 'book' => 'hotel', 'date' => '2026-10-05', 'time' => '10:30:00', 'depositor' => 'Ashok Desai (Manager)', 'reason' => 'Night audit shortfall under_score', 'full_name' => 'Ashok', 'user' => 'Ashok Desai', 'amount' => 9999999.99],
        ['entry_no' => 7, 'book' => 'food', 'date' => '2026-10-05', 'time' => '10:30:00', 'depositor' => 'Hitesh Parmar (Chef)', 'reason' => 'ही दिवाळी साठी', 'full_name' => 'Hitesh', 'user' => 'Hitesh Parmar', 'amount' => 24000.00],
    ];
    $labels = ['hotel' => 'Hotel Pallav', 'food' => 'Pallav Food'];
    $rows = [];
    foreach ($rowsData as $d) {
        $r = new Row([
            'entry_no' => $d['entry_no'], 'book' => $d['book'], 'date' => new DateTimeImmutable($d['date']), 'time' => $d['time'],
            'depositor' => $d['depositor'], 'reason' => $d['reason'], 'full_name' => $d['full_name'], 'user' => new Person($d['user']),
            'amount' => $d['amount'], 'amount_in_words' => NumberToWords::convert($d['amount']),
        ]);
        $rows[] = $r;
    }
    $out['searchRows'] = array_map(fn ($d) => $d + ['amount_in_words' => NumberToWords::convert($d['amount'])], $rowsData);
    $queries = ['', '   ', 'asha', 'ASHA PATEL', 'asha hotel', 'asha food', '-asha', 'hotel -asha', '"walk-in guests"', '"guests walk-in"', 'walk-in', 'walk in',
        'deposit', 'hotel pallav', 'food', '0001', '#0001', '#1', '1', '0007', '24000', '24,000', '24,000.00', '24000.00', '1500.5', '1,500.50', '>5000', '<500',
        '> 5000', '>5,000', '500-2000', '2000-500', '0-1', '0.05', '9999999.99', 'twenty four thousand', 'one lakh', 'lakh', 'fifty paise', 'only',
        '2026-10-05', '05-10-2026', '5 oct 2026', 'oct', 'monday', 'sunday', 'friday', '09:15', '23:59', '00:00', '10:30', '12:00',
        '50%', '%', '_', 'under_score', 'under score', 'o\'brien', 'obrien', 'brien sons', '&', '"', '""', '-', '--', '-"special"', '"special"', 'special order',
        'ही', 'दिवाळी', 'Kiran', 'kiran (deleted)', 'deleted', 'hdfc', 'bank rajkot', '"bank deposit"', '-"bank deposit"', 'asha -lunch', 'asha >1000', 'asha >100000',
        'hotel >1000 <30000', '>1000 <30000', 'x', 'zzz', "tab\tseparated", '  spaced   words  ', 'Ａｓｈａ'];
    $out['searches'] = [];
    foreach ($queries as $q) {
        $found = CashLedger::search(new Collection($rows), $q, fn ($r) => [$labels[$r->book], 'deposit'])->all();
        $out['searches'][] = ['q' => $q, 'entries' => array_map(fn ($r) => $r->a['entry_no'], $found)];
    }

    // ---- the date and time stamp ------------------------------------------------------------------------------------
    $stampCases = [];
    foreach (['2026-10-05 00:00:00', '2026-10-05 09:05:07', '2026-10-05 23:59:59', '2026-03-31 23:59:59', '2026-04-01 00:00:00', '2028-02-29 12:30:45'] as $at) {
        $GLOBALS['NOW'] = new DateTimeImmutable($at);
        foreach ([false, true] as $hand) {
            foreach ([false, true] as $editing) {
                foreach ([['date' => '2026-09-30', 'time' => '08:15'], ['date' => '2026-09-30', 'time' => '08:15:30'], ['date' => '2026-09-30', 'time' => '8:5']] as $data) {
                    $stampCases[] = ['nowIst' => $at, 'chosenByHand' => $hand, 'editing' => $editing, 'input' => $data, 'result' => CashLedger::stamp($data, $hand, $editing)];
                }
            }
        }
    }
    $out['stamps'] = $stampCases;

    // ---- today and this month, in IST ------------------------------------------------------------------------------
    $kpi = [];
    foreach (['2026-10-05T04:30:00Z', '2026-10-05T18:29:59Z', '2026-10-05T18:30:00Z', '2026-10-31T18:29:59Z', '2026-10-31T18:30:00Z', '2026-03-31T18:29:59Z',
        '2026-03-31T18:30:00Z', '2026-12-31T18:30:00Z', '2027-12-31T18:29:59Z', '2028-02-28T18:30:00Z', '2028-02-29T18:30:00Z', '2026-01-01T00:00:00Z', '2026-06-30T20:00:00Z'] as $iso) {
        $t = (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('Asia/Kolkata'));
        $kpi[] = ['instant' => $iso, 'today' => $t->format('Y-m-d'), 'monthStart' => $t->modify('first day of this month')->format('Y-m-d'), 'monthEnd' => $t->modify('last day of this month')->format('Y-m-d')];
    }
    $out['istRanges'] = $kpi;

    // totals the way Pallav adds them: floats of rupees, summed, shown to two places
    $totals = [];
    foreach ([[24000.00, 1500.50, 0.05], [0.1, 0.2, 0.3], [9999999.99, 0.01], [1234.56, 7890.12, 3456.78, 0.34], [999999999.99, 0.01]] as $amounts) {
        $totals[] = ['rupees' => $amounts, 'sum' => number_format(array_sum($amounts), 2, '.', ''), 'paise' => (int) round(array_sum($amounts) * 100)];
    }
    $out['totals'] = $totals;

    // ---- expense lines: the price and total of a line, copied VERBATIM from ExpenseController::resolveLines (lines 338, 361, 364-370) ------
    $lineMath = function (string $quantityText, float $listedPrice, string $pricing, ?string $amountText) {
        $quantity = round((float) $quantityText, 3);            // :338
        $price = $listedPrice;                                    // :361 (no saved price here)
        $custom = $pricing === 'custom';                          // :364
        if ($custom) {
            $total = round((float) ($amountText ?? 0), 2);        // :366
            $price = $quantity > 0 ? round($total / $quantity, 2) : 0; // :367
        } else {
            $total = round($quantity * $price, 2);                // :369
        }

        return ['quantity' => $quantity, 'price' => $price, 'total' => $total];
    };
    mt_srand(4242);
    $lines = [];
    $qtys = ['1', '2', '0.5', '2.5', '0.125', '0.001', '0.0004', '0.0005', '1.2345', '1.0005', '999999.999', '1000000', '3', '12', '0.333', '0.667', '7.5', '10', '100', '0.01', '0.1', '1.1', '2.675', '0.045', '1.005'];
    $prices = [0, 1, 5, 10, 12.5, 12.34, 99.99, 100, 0.01, 0.05, 0.99, 1.1, 2.67, 3.33, 33.33, 66.67, 150.5, 1234.56, 9999999.99, 0.29, 1.02, 8.35, 2.68];
    foreach ($qtys as $q) {
        foreach ($prices as $p) {
            $r = $lineMath($q, (float) $p, 'listed', null);
            $lines[] = ['pricing' => 'listed', 'quantity' => $q, 'pricePaise' => (int) round($p * 100), 'outQuantityMilli' => (int) round($r['quantity'] * 1000), 'outPricePaise' => (int) round($r['price'] * 100), 'outTotalPaise' => (int) round($r['total'] * 100)];
        }
    }
    foreach ($qtys as $q) {
        foreach ([1, 5, 99, 100, 12345, 1000, 33, 7, 1, 250050, 99999999, 2] as $paise) {
            $r = $lineMath($q, 0.0, 'custom', number_format($paise / 100, 2, '.', ''));
            $lines[] = ['pricing' => 'custom', 'quantity' => $q, 'amountPaise' => $paise, 'outQuantityMilli' => (int) round($r['quantity'] * 1000), 'outPricePaise' => (int) round($r['price'] * 100), 'outTotalPaise' => (int) round($r['total'] * 100)];
        }
    }
    for ($i = 0; $i < 400; $i++) {
        $q = (string) (mt_rand(1, 999999) / 1000);
        $paise = mt_rand(1, 99999999);
        $r = $lineMath($q, $paise / 100, 'listed', null);
        $lines[] = ['pricing' => 'listed', 'quantity' => $q, 'pricePaise' => $paise, 'outQuantityMilli' => (int) round($r['quantity'] * 1000), 'outPricePaise' => (int) round($r['price'] * 100), 'outTotalPaise' => (int) round($r['total'] * 100)];
        $r = $lineMath($q, 0.0, 'custom', number_format($paise / 100, 2, '.', ''));
        $lines[] = ['pricing' => 'custom', 'quantity' => $q, 'amountPaise' => $paise, 'outQuantityMilli' => (int) round($r['quantity'] * 1000), 'outPricePaise' => (int) round($r['price'] * 100), 'outTotalPaise' => (int) round($r['total'] * 100)];
    }
    $out['lineMath'] = $lines;

    // ---- the short names built from the lines, copied VERBATIM from ExpenseController::summary (lines 388-397) ------------------------------
    $summary = function (array $lines) {
        $items = array_values(array_unique(array_column($lines, 'item')));
        $categories = array_values(array_unique(array_column($lines, 'category')));

        $name = implode(', ', array_slice($items, 0, 2)).(count($items) > 2 ? ' +'.(count($items) - 2).' more' : '');
        $head = $categories[0].(count($categories) > 1 ? ' +'.(count($categories) - 1) : '');

        return ['expense_name' => mb_substr($name, 0, 100), 'expense_head' => mb_substr((string) $head, 0, 60)];
    };
    $summaries = [];
    $cases = [
        [['Milk', 'Dairy']], [['Milk', 'Dairy'], ['Eggs', 'Dairy']], [['Milk', 'Dairy'], ['Eggs', 'Dairy'], ['Bread', 'Bakery']],
        [['Milk', 'Dairy'], ['Milk', 'Dairy'], ['Milk', 'Dairy']], [['A', 'X'], ['B', 'Y'], ['C', 'Z'], ['D', 'X']], [['A', 'X'], ['A', 'Y']],
        [[str_repeat('Long item name ', 8), str_repeat('Long category ', 6)], [str_repeat('Second item ', 8), 'Other']],
        [['दूध', 'डेयरी'], ['अंडे', 'डेयरी'], ['ब्रेड', 'बेकरी']], [['Item1', 'Cat'], ['Item2', 'Cat'], ['Item3', 'Cat'], ['Item4', 'Cat'], ['Item5', 'Cat']],
        [[str_repeat('é', 120), str_repeat('ü', 80)]],
    ];
    foreach ($cases as $case) {
        $in = array_map(fn ($l) => ['item' => $l[0], 'category' => $l[1]], $case);
        $summaries[] = ['lines' => $in, 'summary' => $summary($in)];
    }
    $out['summaries'] = $summaries;

    // ---- the list search over withdrawals and miscellaneous expenses (CashLedger::search with the extra words of ExpenseController::index:77-81) --
    $kinds = ['withdrawal' => 'Cash Withdrawal', 'misc' => 'Miscellaneous Expense'];
    $expData = [
        ['entry_no' => 1, 'book' => 'hotel', 'kind' => 'withdrawal', 'date' => '2026-10-01', 'time' => '09:15:00', 'withdrawer' => 'Ramesh (Kitchen)', 'instruction' => 'Vegetables for the week', 'full_name' => 'Asha', 'user' => 'Asha Patel', 'amount' => 1200.00, 'lines' => []],
        ['entry_no' => 2, 'book' => 'hotel', 'kind' => 'misc', 'date' => '2026-10-02', 'time' => '11:00:00', 'expense_name' => 'Milk, Eggs +1 more', 'expense_head' => 'Dairy +1', 'instruction' => 'Breakfast stock', 'full_name' => 'Kiran', 'user' => 'Kiran Shah', 'amount' => 845.50, 'lines' => [['Dairy', 'Milk'], ['Dairy', 'Eggs'], ['Bakery', 'Bread']]],
        ['entry_no' => 1, 'book' => 'food', 'kind' => 'withdrawal', 'date' => '2026-10-03', 'time' => '18:30:00', 'withdrawer' => 'Hitesh Parmar', 'instruction' => null, 'full_name' => 'Hitesh', 'user' => 'Hitesh Parmar', 'amount' => 5000.00, 'lines' => []],
        ['entry_no' => 2, 'book' => 'food', 'kind' => 'misc', 'date' => '2026-10-04', 'time' => '08:05:00', 'expense_name' => 'Gas cylinder', 'expense_head' => 'Fuel', 'instruction' => 'o\'brien & sons 50%', 'full_name' => 'Asha', 'user' => 'Asha Patel', 'amount' => 1650.00, 'lines' => [['Fuel', 'Gas cylinder']]],
        ['entry_no' => 3, 'book' => 'food', 'kind' => 'misc', 'date' => '2026-10-05', 'time' => '20:45:10', 'expense_name' => 'दूध', 'expense_head' => 'डेयरी', 'instruction' => 'ही दिवाळी', 'full_name' => 'Mihir', 'user' => 'Mihir Jungiwala', 'amount' => 24000.00, 'lines' => [['डेयरी', 'दूध']]],
    ];
    $expRows = [];
    foreach ($expData as $d) {
        $expRows[] = new Row([
            'entry_no' => $d['entry_no'], 'book' => $d['book'], 'kind' => $d['kind'], 'date' => new DateTimeImmutable($d['date']), 'time' => $d['time'],
            'withdrawer' => $d['withdrawer'] ?? null, 'expense_name' => $d['expense_name'] ?? null, 'expense_head' => $d['expense_head'] ?? null,
            'instruction' => $d['instruction'], 'full_name' => $d['full_name'], 'user' => new Person($d['user']), 'amount' => $d['amount'],
            'amount_in_words' => NumberToWords::convert($d['amount']), 'lines' => $d['lines'],
        ]);
    }
    $out['expenseRows'] = array_map(fn ($d) => $d + ['amount_in_words' => NumberToWords::convert($d['amount'])], $expData);
    $expQueries = ['', 'milk', 'milk eggs', 'dairy', 'dairy +1', '"+1 more"', 'withdrawal', 'cash withdrawal', 'miscellaneous', 'misc', 'expense', 'ramesh', 'kitchen', 'vegetables week', 'hotel', 'food', 'hotel miscellaneous',
        'bakery', 'bread', 'fuel', 'gas', 'gas cylinder', '>1000', '<1000', '1000-2000', '24,000', '#0002', '0003', 'asha', '-asha', 'asha misc', 'दूध', 'डेयरी', 'ही', '50%', "o'brien", 'breakfast', 'stock', 'dairy bakery', '-dairy', 'one thousand', 'paise', 'thousand rupees'];
    $out['expenseSearches'] = [];
    foreach ($expQueries as $q) {
        $found = CashLedger::search(new Collection($expRows), $q, fn ($r) => [$labels[$r->book], $kinds[$r->kind], null, ...array_merge(...array_map(fn ($l) => [$l[0], $l[1]], $r->a['lines']))])->all();
        $out['expenseSearches'][] = ['q' => $q, 'entries' => array_map(fn ($r) => $r->a['book'].':'.$r->a['entry_no'], $found)];
    }

    echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
}
