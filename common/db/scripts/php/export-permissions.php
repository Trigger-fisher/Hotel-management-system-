<?php
// Exports Pallav's permission list (modules, their parts, and the one-off abilities) as JSON, straight from Pallav's own
// class, so the platform seed is Pallav's list and not a retyped copy.
// Run (from the HMS folder), pointing at a checkout of the Pallav repo:
//   php db/scripts/php/export-permissions.php "<pallav>/app/Support/Permissions.php" > db/seeds/source/pallav-permissions.json
// (php prints extension warnings on stderr on this PC; they are harmless.)
//
// Source: app/Support/Permissions.php, modules() and abilities(). Order is kept: it is the order of the sidebar and of the
// Roles and Permissions screen.

if ($argc < 2) {
    fwrite(STDERR, "usage: php export-permissions.php <path to Permissions.php>\n");
    exit(1);
}

require $argv[1];

$modules = [];
foreach (App\Support\Permissions::modules() as $key => $module) {
    $parts = [];
    foreach ($module['children'] ?? [] as $partKey => $part) {
        $parts[] = [
            'key' => $key . '.' . $partKey,
            'label' => $part['label'],
            'about' => $part['about'] ?? null,
            'icon' => $part['icon'] ?? null,
            'section' => $part['section'] ?? null,
            'actions' => array_values($part['actions']),
        ];
    }
    $modules[] = [
        'key' => $key,
        'label' => $module['label'],
        'about' => $module['about'] ?? null,
        'icon' => $module['icon'] ?? null,
        'group' => $module['group'] ?? null,
        'actions' => array_values($module['actions']),
        'parts' => $parts,
    ];
}

$abilities = [];
foreach (App\Support\Permissions::abilities() as $key => $ability) {
    $abilities[] = [
        'key' => $key,
        'label' => $ability['label'],
        'about' => $ability['about'] ?? null,
        'icon' => $ability['icon'] ?? null,
        'sensitive' => (bool) ($ability['sensitive'] ?? false),
    ];
}

echo json_encode(['source' => 'app/Support/Permissions.php', 'modules' => $modules, 'abilities' => $abilities], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
