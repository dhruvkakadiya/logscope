// Strip all ANSI escape sequences: colors (\e[...m), cursor positioning (\e[r;cH),
// screen clearing (\e[2J), cursor visibility (\e[?25l), and other CSI sequences.
// eslint-disable-next-line no-control-regex
export const ANSI_RE = /\x1b\[[\d;]*[A-Za-z]|\x1b\[\?\d+[hl]/g;
