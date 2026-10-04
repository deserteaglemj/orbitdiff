import { LIMITS } from "@/domain/limits";

import { AppError } from "./errors";

export interface Pagination {
  page: number;
  pageSize: number;
  /** Rows to skip: (page - 1) * pageSize. */
  offset: number;
}

/** The list response shape from docs/web/design.md section 8. */
export interface ListEnvelope<T> {
  data: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

const MAX_PAGE = 100_000;

function positiveInteger(raw: string | null, field: string, fallback: number): number {
  if (raw === null || raw === "") return fallback;
  if (!/^[0-9]{1,9}$/.test(raw) || Number(raw) < 1) {
    throw new AppError("invalid_input", `${field} must be a positive whole number.`, { fields: [field] });
  }
  return Number(raw);
}

/**
 * Read `page` and `pageSize` from a query string. Missing values take the
 * defaults, a page size above the maximum is capped, anything that is not a
 * positive whole number is rejected.
 */
export function parsePagination(searchParams: URLSearchParams): Pagination {
  const page = positiveInteger(searchParams.get("page"), "page", 1);
  if (page > MAX_PAGE) {
    throw new AppError("invalid_input", "page is out of range.", { fields: ["page"] });
  }
  const pageSize = Math.min(
    positiveInteger(searchParams.get("pageSize"), "pageSize", LIMITS.pageSizeDefault),
    LIMITS.pageSizeMax,
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function listEnvelope<T>(
  data: T[],
  pagination: Pick<Pagination, "page" | "pageSize">,
  totalItems: number,
): ListEnvelope<T> {
  return {
    data,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pagination.pageSize),
    },
  };
}
