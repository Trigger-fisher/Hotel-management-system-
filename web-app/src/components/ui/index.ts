// The small shared library. The dashboard is written in Hotel Pallav's own markup (src/dashboards/pallav/ui), so what is left here is the
// logic that does not draw anything (data loading, submitting, toasts) plus the pieces of the sign-in screens.

// Foundations
export { Icon, iconNames, hasIcon, type IconName, type IconProps } from './Icon';
export { useFocusTrap, useIsClient, useOnline, useMedia } from './focus';
export { useAsync, shareUnchanged, type AsyncState, type UseAsyncOptions } from './useAsync';
export { refreshActivity, useRefreshing, useRefreshFailed } from './refreshActivity';
export { usePagedAsync } from './usePagedAsync';
export { errorText, fieldErrors } from './dashErrors';
export { useSubmit, toInt, toNum, type FieldErrors } from './useSubmit';
export { useAction, openUrl, type RunOptions } from './useAction';
export { useDebounced } from './useDebounced';
export { usePageSize } from './usePageSize';

// Buttons of the sign-in flow
export { Button, IconButton, Spinner, PrimaryButton, SecondaryButton, LinkButton, TextLink, type ButtonProps, type IconButtonProps } from './Button';

// Toasts (Pallav's own `.toast-item` markup)
export { ToastProvider, useToast, type ToastInput } from './Toast';

// Sign-in flow forms (large 48px fields with icons, code field, password rules)
export { TextField, PasswordField, CodeField, type TextFieldProps } from './TextField';
export { inputAttrs, fieldAria, type InputKind, type InputAttrs } from './inputProps';

// Notes, chips and small status pieces
export {
  Note,
  Banner,
  OfflineNote,
  OfflineBanner,
  StatusIcon,
  StepPill,
  WhoChip,
  Aside,
  PasswordRules,
  PasswordChecklist,
  MatchLine,
  Avatar,
  initials,
} from './Feedback';
