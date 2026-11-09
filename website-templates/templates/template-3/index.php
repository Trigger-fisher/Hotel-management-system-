<?php
// Template 3: coming soon page. Change the values below for each hotel.
$site = [
    'template' => 'Template Site Three',
    'tagline'  => 'Our new website is on its way.',
    'message'  => 'We are getting everything ready for your stay. Please check back soon.',
    'phone'    => '',
    'email'    => '',
];
$e = fn (string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= $e($site['template']) ?> | Coming soon</title>
  <meta name="description" content="<?= $e($site['tagline']) ?>">
  <meta name="robots" content="noindex">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500&display=swap">
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <main class="page">
    <div class="frame">
      <p class="eyebrow">Coming soon</p>
      <h1><?= $e($site['template']) ?></h1>
      <div class="rule" aria-hidden="true"><span></span></div>
      <p class="tagline"><?= $e($site['tagline']) ?></p>
      <p class="message"><?= $e($site['message']) ?></p>
      <?php if ($site['phone'] !== '' || $site['email'] !== ''): ?>
        <p class="contact">
          <?php if ($site['phone'] !== ''): ?><a href="tel:<?= $e($site['phone']) ?>"><?= $e($site['phone']) ?></a><?php endif; ?>
          <?php if ($site['email'] !== ''): ?><a href="mailto:<?= $e($site['email']) ?>"><?= $e($site['email']) ?></a><?php endif; ?>
        </p>
      <?php endif; ?>
    </div>
    <footer>&copy; <?= date('Y') ?> <?= $e($site['template']) ?></footer>
  </main>
</body>
</html>
