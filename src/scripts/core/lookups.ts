import {
  importLookupEppo as workerImportLookupEppo,
  importLookupBbch as workerImportLookupBbch,
  searchEppoCodes as workerSearchEppoCodes,
  searchBbchStages as workerSearchBbchStages,
  getLookupStats as workerGetLookupStats,
} from "./storage/sqlite";

export type LookupKind = "eppo" | "bbch";

interface LookupStatsEntry {
  count: number;
  lastImport?: string | null;
}

export interface LookupStats {
  eppo: LookupStatsEntry;
  bbch: LookupStatsEntry;
}

export interface EppoLookupResult {
  code: string;
  name: string;
  dtcode?: string | null;
  language?: string | null;
  dtLabel?: string | null;
  languageLabel?: string | null;
  authority?: string | null;
  nameDe?: string | null;
  nameEn?: string | null;
  nameLa?: string | null;
}

export interface BbchLookupResult {
  code: string;
  label: string;
  principalStage: number | null;
  secondaryStage: number | null;
  definition?: string | null;
  kind?: string | null;
}

export interface LookupSearchOptions {
  query?: string;
  limit?: number;
  offset?: number;
  language?: string;
}

export interface LookupSearchResult<T> {
  rows: T[];
  total: number;
}

const LOOKUP_ASSETS: Record<LookupKind, string> = {
  eppo: new URL("../../../database/eppocodes.sqlite", import.meta.url).href,
  bbch: new URL("../../../database/bbch.sqlite", import.meta.url).href,
};

const availability: Record<LookupKind, boolean> = {
  eppo: false,
  bbch: false,
};

const importPromises: Partial<Record<LookupKind, Promise<void>>> = {};

async function fetchLookupAsset(kind: LookupKind): Promise<ArrayBuffer> {
  const assetUrl = LOOKUP_ASSETS[kind];
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(
      `Lookup-Datei (${kind}) konnte nicht geladen werden (Status ${response.status})`
    );
  }
  return response.arrayBuffer();
}

async function hasLookupData(kind: LookupKind): Promise<boolean> {
  const stats = (await workerGetLookupStats()) as LookupStats | undefined;
  if (!stats) {
    return false;
  }
  const entry = stats[kind];
  if (entry && entry.count > 0) {
    availability[kind] = true;
    return true;
  }
  return false;
}

async function importLookupFromAsset(kind: LookupKind): Promise<void> {
  const buffer = await fetchLookupAsset(kind);
  if (kind === "eppo") {
    await workerImportLookupEppo(buffer);
  } else {
    await workerImportLookupBbch(buffer);
  }
  availability[kind] = true;
}

export async function ensureLookupData(kind: LookupKind): Promise<void> {
  if (availability[kind]) {
    return;
  }
  if (!importPromises[kind]) {
    importPromises[kind] = (async () => {
      const alreadyPresent = await hasLookupData(kind);
      if (alreadyPresent) {
        return;
      }
      await importLookupFromAsset(kind);
    })().finally(() => {
      importPromises[kind] = undefined;
    });
  }
  await importPromises[kind];
}

export async function reloadLookup(kind: LookupKind): Promise<void> {
  await importLookupFromAsset(kind);
}

export async function getLookupStats(): Promise<LookupStats | null> {
  try {
    const stats = (await workerGetLookupStats()) as LookupStats | undefined;
    if (!stats) {
      return null;
    }
    return stats;
  } catch (error) {
    console.warn("Lookup-Statistiken nicht verfügbar:", error);
    return null;
  }
}

function normalizeSearchResult<T>(result: unknown): LookupSearchResult<T> {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as any).rows)
  ) {
    const total = Number((result as any).total);
    return {
      rows: (result as any).rows as T[],
      total: Number.isFinite(total)
        ? Number(total)
        : (result as any).rows.length,
    };
  }
  if (Array.isArray(result)) {
    const rows = result as T[];
    return { rows, total: rows.length };
  }
  return { rows: [], total: 0 };
}

async function performLookupSearch<T extends LookupKind>(
  kind: T,
  workerFn: (params: {
    query: string;
    limit: number;
    offset: number;
    language?: string;
  }) => Promise<unknown>,
  options: LookupSearchOptions
): Promise<
  LookupSearchResult<T extends "eppo" ? EppoLookupResult : BbchLookupResult>
> {
  try {
    await ensureLookupData(kind);
  } catch (error) {
    console.error(`${kind.toUpperCase()}-Lookup nicht verfügbar:`, error);
    return { rows: [], total: 0 } as LookupSearchResult<
      T extends "eppo" ? EppoLookupResult : BbchLookupResult
    >;
  }

  try {
    const payload: {
      query: string;
      limit: number;
      offset: number;
      language?: string;
    } = {
      query: options.query ?? "",
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    };
    if (options.language) {
      payload.language = options.language;
    }
    const result = await workerFn(payload);
    return normalizeSearchResult<
      T extends "eppo" ? EppoLookupResult : BbchLookupResult
    >(result);
  } catch (error) {
    console.error(`${kind.toUpperCase()}-Suche fehlgeschlagen:`, error);
    return { rows: [], total: 0 } as LookupSearchResult<
      T extends "eppo" ? EppoLookupResult : BbchLookupResult
    >;
  }
}

export async function searchEppoLookup(
  options: LookupSearchOptions
): Promise<LookupSearchResult<EppoLookupResult>> {
  return performLookupSearch("eppo", workerSearchEppoCodes, options);
}

export async function searchBbchLookup(
  options: LookupSearchOptions
): Promise<LookupSearchResult<BbchLookupResult>> {
  return performLookupSearch("bbch", workerSearchBbchStages, options);
}

export async function searchEppoSuggestions(
  query: string,
  limit = 20
): Promise<EppoLookupResult[]> {
  const result = await searchEppoLookup({ query, limit, offset: 0 });
  return result.rows;
}

export async function searchBbchSuggestions(
  query: string,
  limit = 20
): Promise<BbchLookupResult[]> {
  const result = await searchBbchLookup({ query, limit, offset: 0 });
  return result.rows;
}
