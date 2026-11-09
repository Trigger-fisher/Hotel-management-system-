// All text on the authentication screens. Web and mobile use exactly these strings.
// Researched 2026-10-05 (Cloudbeds, Mews, GOV.UK design system, NN/g, OWASP, Smashing).
// Rules: always "Sign in" (never "Log in"); errors never reveal whether an account exists;
// placeholders in {braces} are filled with fill().

import type { AuthErrorCode, Role } from './types';
import type { FieldError, PasswordCheck } from './validation';

export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

export const productName = 'EasyHotelSolutions';

export const copy = {
  brand: {
    /** Brand row above the card (Pallav design, MJ 2026-10-05). Placeholder until MJ picks a logo. */
    mark: 'E',
    name: 'EasyHotelSolutions',
    tagline: 'Hotel management, made easy',
    copyright: '© {year} EasyHotelSolutions',
    /** The maker's mark under the card (MJ 26 Oct 2026: "only my company name"): Elphinix builds and runs HMS. */
    partner: {
      label: 'Engineered by Elphinix. Rise beyond limits.',
      by: 'Engineered by',
      name: 'Elphinix',
      tagline: 'Rise beyond limits',
    },
    headline: 'Your whole property, ready for the next shift',
    points: [
      'Check-ins, POS bills and bookings update live at every counter',
      'Change a rate once. Every channel follows.',
      'One sign-in for every property you run',
    ],
    footer: 'Secure sign-in with two-step verification',
  },
  /**
   * The brand banner beside every sign-in card (MJ 2026-10-18, option 1): logo and name on top, a headline and one line that change per page,
   * feature pills on the sign-in page only. A page without `line` shows the headline alone.
   */
  banner: {
    mark: 'E',
    name: 'EasyHotelSolutions',
    label: 'EasyHotelSolutions',
    pills: ['Front desk', 'Billing', 'Payroll', 'Guests', 'Reports'],
    pages: {
      // Decision 69 (MJ 26 Oct 2026, "a good quote"): the sign-in headline of the glass frame.
      signIn: { headline: 'Every guest remembered. Every detail handled.', line: 'Front desk, billing, payroll and guests, run from one calm place.' },
      forgotPassword: { headline: 'Even the best concierge loses a key.', line: 'No worries. We will get you a new one in a minute.' },
      checkEmail: { headline: 'Check your inbox.', line: 'Your reset link is on its way. Peek in spam if it is shy.' },
      emailCode: { headline: 'One last knock on the door.', line: 'Enter the 6-digit code we just sent. It keeps your hotel safe.' },
      newPassword: { headline: 'Fresh key, fresh start.', line: 'Pick a strong password you have not used before.' },
      welcome: { headline: 'Welcome aboard.', line: 'Set your own password and you are in.' },
      passwordChanged: { headline: 'All set. Welcome back in.' },
      screenLocked: { headline: 'Taking a short break?', line: 'Your desk is safe. Sign in again to carry on.' },
      signedOut: { headline: 'See you soon.', line: 'You have been signed out safely.' },
      locked: { headline: 'Let us pause for a moment.', line: 'Too many tries. Wait a few minutes or reset your password.' },
      blocked: { headline: 'This account is paused.', line: 'Please contact the person who gave you this account.' },
    },
  },
  /** Step pill above the title (Pallav design). Steps not listed show no pill. */
  stepPill: {
    twoFactor: 'Step 2 of 2',
    recoveryCode: 'Step 2 of 2',
    setupTwoFactor: 'Step 2 of 3',
    recoveryCodes: 'Step 3 of 3',
    changePassword: 'Step 2 of 2',
  },
  common: {
    show: 'Show',
    hide: 'Hide',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    backToSignIn: 'Back to sign in',
    tryAgain: 'Try again',
    copied: 'Copied',
    copyFailed: "Couldn't copy. Select the text and copy it by hand.",
  },
  signIn: {
    title: 'Sign in',
    subtitle: 'Welcome back. Sign in to open your property.',
    identifierLabel: 'Mobile number, email or username',
    identifierHint: 'You can leave out +91.',
    passwordLabel: 'Password',
    capsLock: 'Caps Lock is on',
    forgot: 'Forgot password?',
    submit: 'Sign in',
    busy: 'Signing in…',
    noAccount: 'New here? Your hotel admin can send you an invite.',
  },
  twoFactor: {
    title: 'Enter your security code',
    subtitle: 'Open your authenticator app and enter the 6-digit code for EasyHotelSolutions. The code changes every 30 seconds.',
    codeLabel: '6-digit code',
    submit: 'Verify',
    busy: 'Verifying…',
    useRecovery: "Can't use your app? Use a recovery code",
    rememberDevice: "Don't ask for a code on this device for 30 days",
    rememberDeviceWarning: "Don't tick this on a shared front-desk computer.",
  },
  recoveryCode: {
    title: 'Use a recovery code',
    subtitle: 'Enter one of the recovery codes you saved when you set up your security code. Each code works only once.',
    codeLabel: 'Recovery code',
    submit: 'Continue',
    busy: 'Checking…',
    useApp: 'Use authenticator app instead',
    lost: 'No codes left? Ask your hotel admin to reset your security code.',
  },
  setupTwoFactor: {
    title: 'Set up a security code',
    subtitle: 'Your account needs a security code each time you sign in. It takes about a minute.',
    step1: 'Install an authenticator app, such as Google Authenticator or Microsoft Authenticator.',
    step2: 'Scan this QR code with the app.',
    step2Mobile: 'Open your authenticator app with the button below, or enter the key by hand.',
    openApp: 'Open authenticator app',
    qrAlt: 'QR code to scan with your authenticator app',
    noApp: 'No authenticator app found. Install one, then try again, or enter the key by hand.',
    manualLink: "Can't scan? Enter this key instead",
    keyLabel: 'Setup key',
    copyKey: 'Copy key',
    step3: 'Enter the 6-digit code the app shows.',
    submit: 'Turn on security code',
    busy: 'Turning on…',
    loading: 'Preparing your setup key…',
  },
  recoveryCodes: {
    title: 'Save your recovery codes',
    subtitle: 'If you lose your phone, these codes let you sign in. Each code works once. We show them only this one time.',
    copy: 'Copy codes',
    download: 'Download codes',
    share: 'Share codes',
    fileHeading: 'EasyHotelSolutions recovery codes for {email}. Each code works once.',
    fileName: 'hms-recovery-codes.txt',
    confirm: 'I have saved these codes somewhere safe',
    submit: 'Continue',
  },
  changePassword: {
    title: 'Set your own password',
    subtitle: 'You signed in with a temporary password. Choose a new one to continue.',
    submit: 'Save and continue',
    busy: 'Saving…',
  },
  forgotPassword: {
    title: 'Reset your password',
    subtitle: "Enter the email address on your account. We'll send you a link to set a new password.",
    emailLabel: 'Email address',
    submit: 'Send reset link',
    busy: 'Sending…',
    noEmail: 'No email on your account? Ask your hotel admin to reset your password.',
  },
  forgotPasswordSent: {
    title: 'Check your email',
    body: "If an account uses {email}, we've sent a link to reset your password. The link works for 30 minutes.",
    hint: "Can't find it? Check your spam folder or try again in a few minutes.",
    resend: 'Send again',
  },
  resetPassword: {
    title: 'Choose a new password',
    forAccount: 'For {email}',
    loading: 'Checking your link…',
    checkFailedTitle: "We couldn't check your link",
    submit: 'Save new password',
    busy: 'Saving…',
  },
  resetDone: {
    title: 'Password changed',
    body: 'You can now sign in with your new password.',
    action: 'Sign in',
  },
  acceptInvite: {
    title: 'Join {place} on EasyHotelSolutions',
    subtitle: '{inviterName} invited you as {role}. Set a password to get started.',
    forAccount: 'Your sign-in email: {email}',
    loading: 'Checking your invite…',
    checkFailedTitle: "We couldn't check your invite",
    submit: 'Create password and sign in',
    busy: 'Setting up…',
  },
  newPassword: {
    label: 'New password',
    confirmLabel: 'Re-enter new password',
    rulesTitle: 'Your password must:',
    /** Read by screen readers after each rule, e.g. "Have a number (0-9): Done". */
    passwordsMatch: 'Passwords match',
    ruleMet: 'Done',
    ruleNotMet: 'Not yet',
    rules: {
      length: 'Be at least 8 characters',
      uppercase: 'Have an uppercase letter (A-Z)',
      lowercase: 'Have a lowercase letter (a-z)',
      number: 'Have a number (0-9)',
      special: 'Have a special character, like @ # $ !',
      not_identifier: 'Not contain your username or email',
      no_invisible: 'Not contain spaces or hidden characters',
    } satisfies Record<PasswordCheck['id'], string>,
  },
  locked: {
    title: 'Account locked for now',
    /** {minutes} comes from minutesText(), which includes the unit ("1 minute", "15 minutes"). */
    body: 'Too many sign-in attempts. Try again in {minutes}, or reset your password.',
    shareHint: 'Each staff member should use their own account.',
    reset: 'Reset password',
  },
  sessionEnded: {
    SESSION_REPLACED: {
      title: "You've been signed out",
      body: 'Your account was signed in on another device. For security, only one session stays active.',
      hint: "Wasn't you? Sign in and change your password.",
    },
    SESSION_EXPIRED: {
      title: 'Your session has ended',
      body: 'For security, you were signed out. Please sign in again.',
      hint: '',
    },
    action: 'Sign in again',
  },
  screenLocked: {
    title: 'Screen locked',
    subtitle: 'You were away for a while. Enter your password to continue as {name}.',
    submit: 'Unlock',
    busy: 'Unlocking…',
    switchUser: 'Not {name}? Sign in as someone else',
    /** Shown 30 s before the idle lock (WCAG 2.2.1). MJ approved 2026-10-05. */
    warning: "You'll be locked in {seconds} s",
    staySignedIn: 'Stay signed in',
  },
  signedIn: {
    title: 'Welcome, {name}',
    subtitle: 'You are signed in as {role}{place}.',
    placeAt: ' at {hotel}',
    placeFor: ' for {group}',
    placeholder: 'Your dashboard will appear here.',
    lockNow: 'Lock screen',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
  },
  fieldErrors: {
    required: 'This field is required',
    invalid_identifier: 'Enter a valid 10-digit mobile number, email or username',
    invalid_username: 'Enter your username (letters, numbers, dot, dash or underscore)',
    invalid_email: 'Enter a valid email address, like name@hotel.com',
    invisible_characters: 'Remove hidden characters (try typing it instead of pasting)',
    too_short: 'Password must be at least 8 characters',
    too_long: 'Password must be 128 characters or fewer',
    mismatch: 'Passwords do not match',
    password_rules: 'Password must meet all the rules below',
    invalid_code: 'Enter the 6-digit code',
  } satisfies Record<FieldError, string>,
  requiredByField: {
    identifier: 'Enter your mobile number, email or username',
    password: 'Enter your password',
    email: 'Enter your email address',
    code: 'Enter the 6-digit code',
    recoveryCode: 'Enter a recovery code, like ABCDE-12345',
    confirmPassword: 'Re-enter your new password',
    /** Login v2 (username only). Also in auth-pallav/copy. */
    username: 'Enter your username or email',
  },
} as const;

/** Friendly message for every error code. Never show error.message from the server directly. */
export const errorText: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: "Those details didn't match. Check them and try again.",
  ACCOUNT_DISABLED: 'This account is switched off. Please ask the person who gave you this account to switch it on again.',
  ACCOUNT_LOCKED: 'Too many sign-in attempts. Your account is locked for now.',
  INVALID_CODE: "That code didn't work. Check your latest email and enter the 6-digit code.",
  CODE_ATTEMPTS_EXCEEDED: 'Too many wrong codes. Please sign in again.',
  CHALLENGE_EXPIRED: 'That took too long. Please sign in again.',
  RESET_LINK_INVALID: "This link doesn't work. Request a new one.",
  RESET_LINK_EXPIRED: 'This link has expired. Request a new one.',
  ACCOUNT_BLOCKED: 'This account is blocked. Please contact the person who gave you this account.',
  PASSWORD_CHANGE_REQUIRED: 'Please set your own password to continue.',
  SESSION_REVOKED: 'You were signed out because your account changed. Please sign in again.',
  IDEMPOTENCY_KEY_REUSED: 'This request was already sent with different details. Please refresh and try again.',
  REQUEST_IN_PROGRESS: 'We are still saving your last request. Please wait a moment.',
  PASSWORD_TOO_WEAK: 'This password is too common or easy to guess. Choose a different one.',
  PASSWORD_REUSED: "You've used this password before. Choose a new one.",
  SCREEN_LOCKED: 'Your screen is locked. Enter your password to carry on.',
  SESSION_EXPIRED: 'Your session has ended. Please sign in again.',
  SESSION_REPLACED: 'You were signed out because your account was used on another device.',
  VALIDATION_FAILED: 'Some details need fixing. Check what you typed and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
  NETWORK_OFFLINE: "You're offline. Check your internet connection and try again.",
  SERVER_ERROR: 'Something went wrong on our side. Please try again in a moment.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export const roleLabel: Record<Role, string> = {
  super_admin: 'Super Admin',
  platform_admin: 'Platform Admin',
  group_hotel_admin: 'Group Hotel Admin',
  hotel_admin: 'Hotel Admin',
  hotel_user: 'Hotel User',
  corporate_user: 'Corporate User',
  guest_user: 'Guest',
};

/**
 * Every role lands on its OWN dashboard after sign-in (MJ, 2026-10-05: all 8 roles,
 * including Employee, Corporate and Guest). Until each dashboard is built as its own
 * feature, the signedIn step shows this role-specific placeholder.
 */
export const roleHome: Record<Role, { title: string; scope: string }> = {
  super_admin: { title: 'Platform overview', scope: 'Every hotel, group and user on EasyHotelSolutions' },
  platform_admin: { title: 'Hotels and groups', scope: 'Create and manage hotels and hotel groups' },
  group_hotel_admin: { title: 'Group dashboard', scope: 'The hotels in your group' },
  hotel_admin: { title: 'Hotel dashboard', scope: 'Everything in your hotel' },
  hotel_user: { title: 'My work', scope: 'The modules your hotel admin gave you' },
  corporate_user: { title: 'Company dashboard', scope: "Your company's stays and bills" },
  guest_user: { title: 'My stays', scope: 'Your bookings and bills' },
};

/** "15 minutes", "1 minute". */
export function minutesText(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? '1 minute' : `${m} minutes`;
}
