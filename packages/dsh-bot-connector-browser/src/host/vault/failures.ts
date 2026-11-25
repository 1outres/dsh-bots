/** What the model reads when a login helper stopped (it never says more than its code). */
import type { HelperFailure } from "./protocol"

const TEXTS: Readonly<Record<HelperFailure, string>> = {
  devtools:
    "the browser's DevTools could not be reached; check that the browser is ready and try again",
  "not-found":
    "the marked element is gone (the page changed); take a new browser_snapshot and use its ref",
  ambiguous: "the element could not be told apart from another; take a new browser_snapshot",
  "not-editable":
    "the element is not a text field (an enabled input, textarea or editable element); pick the field's ref",
  "not-password-field":
    "a password goes only into a password field (type=password, or autocomplete current-password / new-password)",
  "not-text": "the value is not text that can be typed",
  "opaque-origin":
    "the field is in a frame without a web origin (sandboxed, or not http/https); nothing was filled",
  "origin-changed":
    "the page went to another site before the value was entered; nothing was filled",
  "focus-lost":
    "the field lost the focus; take a new browser_snapshot to see what the field holds before trying again",
  rejected: "the browser did not take the passkey",
  protocol: "the browser's login helper failed",
  failed: "the browser's login helper failed",
}

export class HelperFailureError extends Error {
  constructor(readonly code: HelperFailure) {
    super(TEXTS[code])
    this.name = "HelperFailureError"
  }
}
