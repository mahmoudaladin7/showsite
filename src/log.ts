const tty = process.stderr.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

export const color = {
  dim: paint(2),
  bold: paint(1),
  green: paint(32),
  red: paint(31),
  yellow: paint(33),
  coral: (s: string) => (tty ? `\x1b[38;2;232;94;58m${s}\x1b[0m` : s),
};

let quiet = false;
let lastProgress = 0;

export const log = {
  setQuiet(value: boolean) {
    quiet = value;
  },
  step(message: string) {
    if (!quiet) process.stderr.write(`${color.coral("●")} ${message}\n`);
  },
  info(message: string) {
    if (!quiet) process.stderr.write(`  ${color.dim(message)}\n`);
  },
  done(message: string) {
    if (!quiet) process.stderr.write(`${color.green("✓")} ${message}\n`);
  },
  warn(message: string) {
    if (!quiet) process.stderr.write(`${color.yellow("!")} ${message}\n`);
  },
  error(message: string) {
    process.stderr.write(`${color.red("✗")} ${message}\n`);
  },
  /** A single updating progress line. */
  progress(label: string, done: number, total: number) {
    if (quiet) return;
    const now = Date.now();
    if (done < total && now - lastProgress < 100) return;
    lastProgress = now;
    const width = 24;
    const filled = Math.round((done / total) * width);
    const bar = "█".repeat(filled) + color.dim("░".repeat(width - filled));
    const pct = String(Math.round((done / total) * 100)).padStart(3);
    if (tty) {
      process.stderr.write(`\r  ${bar} ${pct}%  ${color.dim(label)}\x1b[K`);
      if (done >= total) process.stderr.write("\n");
    } else if (done >= total) {
      process.stderr.write(`  ${label}: done\n`);
    }
  },
};
