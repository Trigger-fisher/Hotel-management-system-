'use client';

// The `<table>` element of a list or a form grid (Shared Component). It draws exactly what a hand-written `<table className="...">` draws,
// so the page sheets that style `.table`, `.sh-count-table`, `.dr-table` ... keep working; the point is that screens do not write the element
// themselves. Props are the plain <table> props (ref, id, className ...). Rows and cells stay `<thead>/<tr>/<th>/<td>` (see Th for sortable headers).
import type { ComponentProps } from 'react';

export function Table({ className, ...rest }: ComponentProps<'table'>) {
  return <table {...rest} className={className} />;
}