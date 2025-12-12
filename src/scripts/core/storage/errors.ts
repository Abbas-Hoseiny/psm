export const FILE_PICKER_ABORT_CODE = "FILE_PICKER_ABORT";
export const STORAGE_ERROR_CODE = "STORAGE_ERROR";

/**
 * Standard error for all storage operations
 * Provides consistent error handling across all storage drivers
 */
export class StorageError extends Error {
  public readonly code: string = STORAGE_ERROR_CODE;

  constructor(
    message: string,
    public readonly driver: "sqlite" | "filesystem" | "localstorage" | "memory",
    public readonly operation:
      | "create"
      | "open"
      | "save"
      | "query"
      | "delete"
      | "init"
      | "export"
      | "import",
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "StorageError";

    // Maintain proper stack trace (V8 engines only)
    if (
      "captureStackTrace" in Error &&
      typeof (Error as ErrorConstructor & { captureStackTrace?: unknown })
        .captureStackTrace === "function"
    ) {
      (
        Error as ErrorConstructor & {
          captureStackTrace: (err: Error, ctor: Function) => void;
        }
      ).captureStackTrace(this, StorageError);
    }
  }

  /**
   * Create user-friendly error message
   */
  toUserMessage(): string {
    const operationLabels: Record<string, string> = {
      create: "Erstellen der Datenbank",
      open: "Öffnen der Datenbank",
      save: "Speichern der Daten",
      query: "Datenbankabfrage",
      delete: "Löschen der Daten",
      init: "Initialisierung der Datenbank",
      export: "Exportieren der Daten",
      import: "Importieren der Daten",
    };

    const driverLabels: Record<string, string> = {
      sqlite: "SQLite",
      filesystem: "Dateisystem",
      localstorage: "LocalStorage",
      memory: "Speicher",
    };

    const op = operationLabels[this.operation] || this.operation;
    const drv = driverLabels[this.driver] || this.driver;

    return `${op} fehlgeschlagen (${drv}): ${this.message}`;
  }
}

/**
 * Check if an error is a StorageError
 */
export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

/**
 * Wrap any error as a StorageError
 */
export function wrapStorageError(
  error: unknown,
  driver: StorageError["driver"],
  operation: StorageError["operation"],
  fallbackMessage = "Unbekannter Fehler"
): StorageError {
  if (error instanceof StorageError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error || fallbackMessage);
  const cause = error instanceof Error ? error : undefined;

  return new StorageError(message, driver, operation, cause);
}

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
