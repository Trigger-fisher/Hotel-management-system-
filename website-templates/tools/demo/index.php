<?php
// Local demo of "hotel picks a template": Apply copies templates/template-N into sites/<hotel>/ (what the
// Create hotel site job will do), then the hotel's site is served from its own copied code.
// Run from website-templates/:  php -S localhost:8080   then open http://localhost:8080/tools/demo/
$base = dirname(__DIR__, 2);
$hotels = ['demo-grandpalace' => 'Grand Palace', 'demo-seaview' => 'Sea View'];
$words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
$e = fn (string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');

function copyDir(string $from, string $to): void {
    if (is_dir($to)) removeDir($to);
    mkdir($to, 0777, true);
    foreach (scandir($from) as $f) {
        if ($f === '.' || $f === '..') continue;
        is_dir("$from/$f") ? copyDir("$from/$f", "$to/$f") : copy("$from/$f", "$to/$f");
    }
}
function removeDir(string $dir): void {
    foreach (scandir($dir) as $f) {
        if ($f === '.' || $f === '..') continue;
        is_dir("$dir/$f") ? removeDir("$dir/$f") : unlink("$dir/$f");
    }
    rmdir($dir);
}
function pickedTemplate(string $site): ?int {
    $m = is_file("$site/PICKED.txt") ? trim(file_get_contents("$site/PICKED.txt")) : '';
    return ctype_digit($m) ? (int) $m : null;
}

$done = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $hotel = $_POST['hotel'] ?? '';
    $n = (int) ($_POST['template'] ?? 0);
    if (isset($hotels[$hotel]) && $n >= 1 && $n <= 10) {
        $site = "$base/sites/$hotel";
        copyDir("$base/templates/template-$n", $site);
        // the hotel's own copy gets the hotel's name: this file is now that hotel's code
        $page = file_get_contents("$site/index.php");
        $page = str_replace("'Our new website is on its way.'", var_export("{$hotels[$hotel]}: our new website is on its way.", true), $page);
        file_put_contents("$site/index.php", $page);
        file_put_contents("$site/PICKED.txt", (string) $n);
        $done = "{$hotels[$hotel]} now runs Template $n. Its code was copied to sites/$hotel/.";
    }
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Choose website template (demo)</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 28px 20px; background: #f4f5f3; color: #1d2420; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .sub { margin: 0 0 22px; color: #5d6862; }
    .done { background: #e6f2ec; border: 1px solid #b9dcc9; padding: 10px 14px; border-radius: 8px; margin-bottom: 20px; }
    .hotels { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; }
    .hotel { background: #fff; border: 1px solid #dde3df; border-radius: 10px; padding: 16px; }
    .hotel h2 { margin: 0 0 4px; font-size: 18px; }
    .meta { margin: 0 0 12px; color: #5d6862; font-size: 14px; }
    form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    select, button { font: inherit; padding: 7px 10px; border-radius: 6px; border: 1px solid #c7cfca; }
    button { background: #23704f; color: #fff; border-color: #23704f; cursor: pointer; }
    .frame { height: 300px; overflow: hidden; border: 1px solid #dde3df; border-radius: 8px; }
    iframe { width: 200%; height: 600px; border: 0; transform: scale(.5); transform-origin: 0 0; }
    a { color: #23704f; }
  </style>
</head>
<body>
  <h1>Website → Choose template</h1>
  <p class="sub">Demo of the hotel admin screen. Apply copies the template's code into that hotel's own folder, and the hotel's site then runs from that copy.</p>
  <?php if ($done): ?><p class="done"><?= $e($done) ?></p><?php endif; ?>
  <div class="hotels">
    <?php foreach ($hotels as $id => $name): $site = "$base/sites/$id"; $cur = pickedTemplate($site); ?>
      <section class="hotel">
        <h2><?= $e($name) ?></h2>
        <p class="meta">Current: <?= $cur ? "Template $cur" : 'no site yet' ?> · code in <code>sites/<?= $e($id) ?>/</code></p>
        <form method="post">
          <input type="hidden" name="hotel" value="<?= $e($id) ?>">
          <label for="t-<?= $e($id) ?>">Template</label>
          <select id="t-<?= $e($id) ?>" name="template">
            <?php foreach ($words as $i => $w): $n = $i + 1; ?>
              <option value="<?= $n ?>" <?= $cur === $n ? 'selected' : '' ?>>Template <?= $n ?> (Site <?= $w ?>)</option>
            <?php endforeach; ?>
          </select>
          <button type="submit">Apply</button>
        </form>
        <?php if ($cur): ?>
          <div class="frame"><iframe src="/sites/<?= $e($id) ?>/?v=<?= time() ?>" title="<?= $e($name) ?> site"></iframe></div>
          <p><a href="/sites/<?= $e($id) ?>/" target="_blank">Open <?= $e($name) ?>'s site</a></p>
        <?php endif; ?>
      </section>
    <?php endforeach; ?>
  </div>
</body>
</html>
