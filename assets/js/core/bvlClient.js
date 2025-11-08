/**
 * BVL API Client
 * Handles fetching data from BVL API with pagination, retries, and error handling
 */

const BVL_BASE_URL = "https://psm-api.bvl.bund.de/ords/psm/api-v1";
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 2;

export class NetworkError extends Error {
  constructor(message, endpoint) {
    super(message);
    this.name = "NetworkError";
    this.endpoint = endpoint;
  }
}

export class HttpError extends Error {
  constructor(message, status, endpoint, responseBody) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

export class ParseError extends Error {
  constructor(message, endpoint) {
    super(message);
    this.name = "ParseError";
    this.endpoint = endpoint;
  }
}

/**
 * Fetch a collection from BVL API with pagination support
 */
export async function fetchCollection(endpoint, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    maxRetries = MAX_RETRIES,
    onProgress = null,
    params = {},
    pageSize = 1000,
  } = options;

  let allItems = [];
  let offset = 0;
  let hasMore = true;
  let attempt = 0;

  while (hasMore) {
    attempt = 0;
    let success = false;
    let lastError = null;

    while (!success && attempt <= maxRetries) {
      try {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null) {
            continue;
          }
          searchParams.append(key, value);
        }
        searchParams.set("limit", pageSize);
        searchParams.set("offset", offset);
        const url = `${BVL_BASE_URL}/${endpoint}?${searchParams.toString()}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const startTime = Date.now();
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;

        if (!response.ok) {
          const responseText = await response.text().catch(() => "");
          const truncatedBody =
            responseText.length > 200
              ? responseText.substring(0, 200) + "..."
              : responseText;

          if (response.status >= 500 && attempt < maxRetries) {
            attempt++;
            lastError = new HttpError(
              `HTTP ${response.status} on attempt ${attempt}`,
              response.status,
              endpoint,
              truncatedBody
            );
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            continue;
          }

          throw new HttpError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            endpoint,
            truncatedBody
          );
        }

        let data;
        try {
          data = await response.json();
        } catch (e) {
          throw new ParseError(
            `Failed to parse JSON response: ${e.message}`,
            endpoint
          );
        }

        const items = data.items || [];
        allItems = allItems.concat(items);

        if (onProgress) {
          onProgress({
            endpoint,
            offset,
            count: items.length,
            total: allItems.length,
            duration,
          });
        }

        if (items.length < pageSize) {
          hasMore = false;
        } else {
          offset += pageSize;
        }

        success = true;
      } catch (error) {
        if (error.name === "AbortError") {
          throw new NetworkError(
            `Request timeout after ${timeout}ms`,
            endpoint
          );
        }

        if (error instanceof HttpError || error instanceof ParseError) {
          throw error;
        }

        if (!navigator.onLine) {
          throw new NetworkError("No internet connection", endpoint);
        }

        if (attempt < maxRetries) {
          attempt++;
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        } else {
          throw new NetworkError(
            `Network error after ${attempt} attempts: ${error.message}`,
            endpoint
          );
        }
      }
    }

    if (!success && lastError) {
      throw lastError;
    }
  }

  return allItems;
}

/**
 * Hash data using SHA-256
 */
export async function hashData(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

/**
 * Compute hashes for all endpoints and a combined hash
 */
export async function computeDatasetHashes(datasets) {
  const hashes = {};
  const combined = [];

  for (const [endpoint, data] of Object.entries(datasets)) {
    const hash = await hashData(data);
    hashes[endpoint] = hash;
    combined.push(hash);
  }

  hashes.combined = await hashData(combined.join(""));
  return hashes;
}
