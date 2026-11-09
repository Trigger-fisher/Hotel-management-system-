// Text for the v2 (Pallav) login steps. Everything shared with v1 (brand, common, newPassword rules,
// fieldErrors, errorText, roleLabel, roleHome, signedIn, screenLocked, sessionEnded) is reused from
// ../auth/copy and must not be copied here.

export const pallavCopy = {
  /** Step pill above the title. Steps not listed show no pill. */
  stepPill: {
    forgotPassword: 'Step 1 of 2',
    resetPassword: 'Step 2 of 2',
  },
  /** Empty-field messages for the new fields (the rest stay in ../auth/copy requiredByField). */
  requiredByField: {
    username: 'Enter your username or email',
    code: 'Enter the 6-digit code',
  },
  /**
   * Portal sign-in (Pallav portal/login + register): the guest "Create your account" view under the one sign-in form. Optional extras: a screen that does not know them keeps the plain sign-in.
   */
  portal: {
    newHere: 'New here?',
    createAccount: 'Create your account',
    register: {
      title: 'Create your account',
      subtitle: 'Sign up once to see your bills, book rooms and order to your room.',
      nameLabel: 'Full name',
      mobileLabel: 'Mobile number',
      emailLabel: 'Email (optional)',
      submit: 'Create account',
      busy: 'Creating...',
      haveAccount: 'Already have one?',
      signIn: 'Sign in',
      done: 'Your account is ready. Sign in with your mobile number and password.',
      requiredName: 'Enter your full name',
      requiredMobile: 'Enter your 10-digit mobile number',
      invalidMobile: 'Enter a valid 10-digit mobile number',
      notAvailable: 'Online sign-up is not open yet. Please ask the front desk to make your account.',
    },
  },
  signIn: {
    title: 'Welcome back',
    subtitle: 'Sign in with your username or email and your password.',
    usernameLabel: 'Username or email',
    passwordLabel: 'Password',
    forgot: 'Forgot password?',
    submit: 'Sign in',
    busy: 'Signing in...',
    noAccount: 'First time here? Sign in with the password we emailed you, then choose your own.',
  },
  emailCode: {
    title: 'Check your email',
    subtitle: 'Enter the 6-digit code we emailed to {email}. It works once, for 10 minutes.',
    codeLabel: '6-digit code',
    submit: 'Sign in',
    busy: 'Checking...',
    resend: 'Send another code',
    resendIn: 'Send another code in {seconds}s',
    resent: 'A new code is on its way.',
    hint: '',
    useDifferent: 'Use a different account',
    /** After a wrong code, under the box: how many tries are left before this code stops working. */
    triesLeft: '{count} more tries for this code.',
    lastTry: 'One more try for this code.',
  },
  changePassword: {
    title: 'Set your own password',
    subtitle: 'Your current password is temporary, so choose one only you know before you continue.',
    submit: 'Save and continue',
    busy: 'Saving...',
    fine: 'Any other device using this account is signed out.',
  },
  forgotPassword: {
    title: 'Forgot your password?',
    subtitle: "Enter your username or email and we'll email you a link to set a new password. The link works for 15 minutes.",
    usernameLabel: 'Username or email',
    submit: 'Email me a link',
    busy: 'Sending...',
    noEmail: 'No email address on the account? An administrator can set a new password for you.',
    /** Shown after sending: the same words whether or not an account matches (the page never says if the username or email exists). */
    sent: {
      title: 'Check your email',
      body: 'If an account matches, we have sent a link to set a new password. It works for 15 minutes. Look in your spam folder too.',
      again: 'Use a different username or email',
    },
  },
  /** The page the emailed link opens: set a new password. */
  resetLink: {
    title: 'Set a new password',
    subtitle: 'Choose a strong password only you know. You will sign in with it next.',
    checkingTitle: 'Checking your link',
    checking: 'One moment while we check that it still works.',
    submit: 'Save new password',
    busy: 'Saving...',
    suggest: 'Suggest a strong password',
    suggestHint: 'We make one in your browser. Copy it into your password manager before you save.',
    show: 'Show',
    hide: 'Hide',
    copy: 'Copy',
    copied: 'Copied',
    expired: {
      title: 'This link has expired or was already used',
      body: 'Links work once and for 15 minutes. Ask for a new link and we will email it.',
      action: 'Send me a new link',
    },
    /** Shown on the sign-in page after a successful change. */
    changed: 'Password changed. Sign in with your new password.',
  },
  resetPassword: {
    title: 'Enter the code and a new password',
    /** Never confirms whether the username exists (MJ #13). */
    subtitle: 'If the username is right, we emailed a 6-digit code to the address on that account. It works for 10 minutes.',
    codeLabel: '6-digit code',
    submit: 'Save new password',
    busy: 'Saving…',
    resend: 'Send a new code',
    resendIn: 'You can ask for a new code in {seconds} s',
  },
  resetDone: {
    title: 'Password changed',
    body: 'You can now sign in with your new password.',
    action: 'Sign in',
  },
  locked: {
    title: 'Account locked for now',
    /** {time} is when the lock ends ("05 Nov 2026, 3:45 pm"); {minutes} from minutesText(). */
    body: 'Too many sign-in attempts. You can try again at {time} (in {minutes}), or reset your password.',
    shareHint: 'Each person should use their own account.',
    reset: 'Reset password',
  },
  blocked: {
    title: 'This account is blocked',
    body: 'This account was blocked. Please contact the person who gave you this account to unblock it.',
    action: 'Back to sign in',
  },
  /**
   * Mock only: the blocked screen for an admin account made by the Platform console's onboarding form (flow.ts blockedReason). Title and
   * body replace pallavCopy.blocked's; the action stays pallavCopy.blocked.action.
   */
  blockedReason: {
    hotel_pending: { title: 'Waiting for approval', body: 'Your hotel is waiting for approval.' },
    group_pending: { title: 'Waiting for approval', body: 'Your group is waiting for approval.' },
    disabled: { title: 'Account switched off', body: 'Your password is right, but this account is switched off. Please ask the person who gave you this account to switch it on again.' },
    hotel_suspended: { title: 'Hotel suspended', body: 'This hotel is suspended. Please contact the platform administrator.' },
    hotel_archived: { title: 'Hotel no longer active', body: 'This hotel is no longer active. Please contact the platform administrator.' },
    hotel_rejected: { title: 'Application not approved', body: 'This hotel application was not approved. Please contact the platform administrator.' },
    group_rejected: { title: 'Application not approved', body: 'This group application was not approved. Please contact the platform administrator.' },
    no_email: { title: 'No email for your code', body: 'Your account needs a sign-in code, but it has no email address. Please ask the person who gave you this account to add one.' },
  },
  /** Under the blocked sentence when the platform staff typed a reason (suspended / archived hotel). */
  blockedReasonLine: (text: string) => `Reason: ${text}`,
  challengeEnded: {
    CHALLENGE_EXPIRED: 'That code has expired. Please sign in again to get a new one.',
    CODE_ATTEMPTS_EXCEEDED: 'Too many wrong codes. Please sign in again to get a new one.',
  },
  sessionRevoked: {
    title: "You've been signed out",
    body: 'Your account was changed (password or access). Please sign in again.',
  },
} as const;
