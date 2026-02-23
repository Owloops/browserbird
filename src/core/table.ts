/** @fileoverview CLI table formatting and output utilities. */

/** Print a formatted table with auto-calculated column widths to stdout. */
export function printTable(
  headers: string[],
  rows: string[][],
  maxWidths?: Array<number | undefined>,
): void {
  const widths = headers.map((h) => h.length);

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cellLen = (row[i] ?? '').length;
      const maxW = maxWidths?.[i];
      const capped = maxW != null ? Math.min(cellLen, maxW) : cellLen;
      widths[i] = Math.max(widths[i] ?? 0, capped);
    }
  }

  function pad(s: string, width: number, max?: number): string {
    const truncated = max != null && s.length > max ? s.slice(0, max - 3) + '...' : s;
    return truncated.padEnd(width);
  }

  const indent = '  ';
  console.log(indent + headers.map((h, i) => pad(h, widths[i]!)).join('  '));
  console.log(indent + widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(
      indent + row.map((cell, i) => pad(cell ?? '', widths[i]!, maxWidths?.[i])).join('  '),
    );
  }
}

export function unknownSubcommand(subcommand: string, command: string): void {
  process.stderr.write(`error: unknown subcommand: ${subcommand}\n`);
  process.stderr.write(`run 'browserbird ${command} --help' for usage\n`);
  process.exitCode = 1;
}
