"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./data-table.module.css";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
};

export type SortState = { sort: string; order: "asc" | "desc" };

/**
 * Presentational only — no fetching, no domain awareness (per the
 * components/ boundary rule in apps/web/eslint.config.mjs). Semantic
 * <table>/<th scope="col"> markup and keyboard-operable sort buttons with
 * aria-sort, per docs/spec/11-accessibility.md's fleet-table requirements.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  sortState,
  onSortChange,
  getRowHref,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  sortState?: SortState;
  onSortChange?: (key: string) => void;
  getRowHref?: (row: T) => string;
  caption?: string;
}) {
  return (
    <table className={styles.table}>
      {caption && <caption className={styles.caption}>{caption}</caption>}
      <thead>
        <tr>
          {columns.map((col) => {
            const isActive = sortState?.sort === col.key;
            const ariaSort = col.sortable ? (isActive ? (sortState!.order === "asc" ? "ascending" : "descending") : "none") : undefined;
            return (
              <th key={col.key} scope="col" aria-sort={ariaSort}>
                {col.sortable && onSortChange ? (
                  <button type="button" className={styles.sortButton} onClick={() => onSortChange(col.key)}>
                    {col.header}
                    {isActive ? <span aria-hidden="true">{sortState!.order === "asc" ? " ▲" : " ▼"}</span> : null}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            {columns.map((col, index) => (
              <td key={col.key}>{getRowHref && index === 0 ? <Link href={getRowHref(row)}>{col.render(row)}</Link> : col.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
