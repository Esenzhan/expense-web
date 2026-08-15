// Groups the integer part with spaces as the user types (1000000 -> "1 000
// 000"), keeping a single "," or "." decimal separator untouched — so big
// round numbers stay readable without needing to count zeros.
export function formatAmountDisplay(raw) {
  const [intPart, ...rest] = raw.split(/([.,])/);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return grouped + rest.join("");
}

// Strips the display spaces back out, rejecting anything but digits and a
// single decimal separator — pass the result to a controlled input's state.
export function sanitizeAmountInput(displayValue) {
  const raw = displayValue.replace(/\s/g, "");
  return /^-?\d*[.,]?\d*$/.test(raw) ? raw : null;
}
