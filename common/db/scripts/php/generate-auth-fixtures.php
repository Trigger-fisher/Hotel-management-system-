<?php
// Golden fixtures for the login backend, made by REAL PHP running Hotel Pallav's own code:
//   * App\Support\PasswordPolicy: REGEX (the password rule), lockMinutes(), lockLabel(), LOCK_STEPS, MAX_ATTEMPTS, generate()
//   * AuthController::maskEmail (private, in a class that needs Laravel): its body is copied here VERBATIM (lines 382-392), the only
//     copy in this file; everything else is Pallav's own file loaded as it is.
//
// Usage:  php db/scripts/php/generate-auth-fixtures.php <path to the Pallav repo> > "web-app/tests/server/fixtures/auth-pallav.json"
declare(strict_types=1);

namespace {
    use App\Support\PasswordPolicy;

    $pallav = $argv[1] ?? null;
    if (! $pallav || ! is_file($pallav.'/app/Support/PasswordPolicy.php')) {
        fwrite(STDERR, "Usage: php generate-auth-fixtures.php <path to the Pallav repo>\n");
        exit(1);
    }
    require_once $pallav.'/app/Support/PasswordPolicy.php';

    // AuthController::maskEmail, lines 382-392, verbatim
    function maskEmail(?string $email): string
    {
        if (! $email || ! str_contains($email, '@')) {
            return 'your email';
        }

        [$name, $domain] = explode('@', $email, 2);
        $shown = mb_substr($name, 0, 2);

        return $shown.str_repeat('*', max(1, mb_strlen($name) - 2)).'@'.$domain;
    }

    $out = ['source' => 'Pallav app/Support/PasswordPolicy.php, app/Http/Controllers/Auth/AuthController.php:382-392; PHP '.PHP_VERSION];

    $out['constants'] = ['maxAttempts' => PasswordPolicy::MAX_ATTEMPTS, 'lockSteps' => PasswordPolicy::LOCK_STEPS, 'maxLockMinutes' => PasswordPolicy::MAX_LOCK_MINUTES, 'message' => PasswordPolicy::MESSAGE];

    $out['lockMinutes'] = [];
    foreach ([-3, -1, 0, 1, 2, 3, 4, 5, 6, 7, 20, 1000] as $level) {
        $out['lockMinutes'][] = ['level' => $level, 'minutes' => PasswordPolicy::lockMinutes($level)];
    }
    $out['lockLabels'] = [];
    foreach ([1, 14, 15, 30, 59, 60, 61, 90, 119, 120, 180, 479, 480, 1439, 1440, 3000] as $m) {
        $out['lockLabels'][] = ['minutes' => $m, 'label' => PasswordPolicy::lockLabel($m)];
    }

    // the password rule over a wide set of candidates
    $passwords = ['', 'a', 'Abcdef1!', 'abcdef1!', 'ABCDEF1!', 'Abcdefg!', 'Abcdefg1', 'Abc1!', 'Abcdef1', 'Abcdef!1', 'Abcdef1 !', 'Abcdef 1!', " Abcdef1!", 'Abcdef1! ',
        'Abcdef1!x', 'Abcdefghij1!', 'A1!aaaaa', 'A1!aaaa', 'Aa1!Aa1!', 'Passw0rd!', 'password', 'Password1', 'P@ssw0rd', 'Pass word1!', "Pass\tword1!", 'Pa$$w0rd', 'Пароль1!a', 'Passwörd1!',
        'Abcdef1é', 'Abcdef1¡', 'ÀBcdef1!', 'Abcdef1!'.str_repeat('x', 120), 'Abcdef1!'.str_repeat('x', 121), 'Abcdef1;', "Abcdef1'", 'Abcdef1"', 'Abcdef1\\', 'Abcdef1/', 'Abcdef1`', 'Abcdef1~', 'Abcdef1|',
        'Abcdef1_', 'Abcdef1-', 'Abcdef1=', 'Abcdef1+', 'Abcdef1[', 'Abcdef1{', 'Abcdef1:', 'Abcdef1,', 'Abcdef1.', 'Abcdef1<', 'Abcdef1?', 'Abcdef1*', 'Abcdef1^', 'Abcdef1%', 'Abcdef1&', 'Abcdef1#',
        'Abcdef1@', 'Abcdef1(', 'Abcdef1)', "Abcdef1\n!", "Abcdef1!\n", "Abcdef1!\r", '１２３Abcdef!', 'Abcdef٣!', 'abcDEF123#', 'Zz9#zzzz', 'Zz9#zzz', 'zZ9#ZZZZ'];
    mt_srand(77);
    $pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{};:\'",.<>/?\\|`~ ';
    for ($i = 0; $i < 400; $i++) {
        $len = mt_rand(1, 14);
        $s = '';
        for ($j = 0; $j < $len; $j++) {
            $s .= $pool[mt_rand(0, strlen($pool) - 1)];
        }
        $passwords[] = $s;
    }
    $out['passwords'] = array_map(fn ($p) => ['password' => $p, 'ok' => preg_match(PasswordPolicy::REGEX, $p) === 1], $passwords);

    // generate(): the policy always holds, the length is kept (min 8), no look-alike characters
    $out['generated'] = [];
    foreach ([8, 12, 20, 3] as $length) {
        for ($i = 0; $i < 50; $i++) {
            $g = PasswordPolicy::generate($length);
            $out['generated'][] = ['length' => $length, 'actual' => strlen($g), 'ok' => preg_match(PasswordPolicy::REGEX, $g) === 1, 'lookalike' => (bool) preg_match('/[O0Il1]/', $g)];
        }
    }

    $out['masked'] = array_map(fn ($e) => ['email' => $e, 'masked' => maskEmail($e)],
        ['anita@demo.hms', 'a@x.io', 'ab@x.io', 'abc@x.io', 'abcd@example.com', 'ही@x.in', 'ही​दिवाळी@x.in', 'x@y@z.com', '', 'noatsign', '@domain.com', 'mihir.jungiwala@gmail.com']);
    $out['masked'][] = ['email' => null, 'masked' => maskEmail(null)];

    echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
}
