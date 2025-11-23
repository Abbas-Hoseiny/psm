export const FILE_PICKER_ABORT_CODE = "FILE_PICKER_ABORT";

export function createFilePickerAbortError(
  message = "Dateiauswahl abgebrochen."
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = FILE_PICKER_ABORT_CODE;
  return error;
}

export function isFilePickerAbortError(error: unknown): error is Error & {
  code: string;
} {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === FILE_PICKER_ABORT_CODE
  );
}

export function isDomAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "AbortError";
}
